import Anthropic from "@anthropic-ai/sdk";
import { MODELS, SYSTEM_PROMPT, TOOLS } from "@/lib/agent";
import type { AgentEvent, AgentRequest, SceneItem } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 120;

const MAX_TURNS = 8;

// True for "Claude is limited / unavailable" — the cases where retrying the same
// model won't help but a different tier might.
function isLimited(err: unknown): boolean {
  // 429 rate limit, 529 overloaded, or a transient 5xx — retrying the same
  // model won't help, but a different tier might.
  return (
    err instanceof Anthropic.APIError &&
    [429, 500, 502, 503, 529].includes((err as { status?: number }).status ?? 0)
  );
}

// Run one turn, falling forward through the model chain on a limit/overload.
// Returns the chosen tier index so the caller can stay there for later turns.
async function runTurn(
  client: Anthropic,
  startIdx: number,
  base: { system: string; tools: Anthropic.Tool[]; messages: Anthropic.MessageParam[] },
  onText: (t: string) => void,
  onFallback: (fromLabel: string, toLabel: string) => void,
): Promise<{ final: Anthropic.Message; idx: number }> {
  let lastErr: unknown;
  for (let i = startIdx; i < MODELS.length; i++) {
    const tier = MODELS[i];
    let produced = false;
    try {
      const ms = client.messages.stream({
        model: tier.model,
        max_tokens: 16000,
        system: base.system,
        tools: base.tools,
        messages: base.messages,
        ...tier.params,
      } as any);
      ms.on("text", (delta) => {
        if (delta) {
          produced = true;
          onText(delta);
        }
      });
      const final = await ms.finalMessage();
      return { final, idx: i };
    } catch (err) {
      lastErr = err;
      // Only fall back before any text streamed (avoids duplicated output) and
      // only for limit/overload errors with a tier left to try.
      if (!produced && isLimited(err) && i + 1 < MODELS.length) {
        onFallback(tier.label, MODELS[i + 1].label);
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}

const LABELABLE = new Set(["rectangle", "ellipse", "diamond"]);

function sceneToText(scene: SceneItem[]): string {
  if (!scene.length) return "The canvas is empty. Start near (200, 140).";

  const r = Math.round;
  const minX = Math.min(...scene.map((e) => e.x));
  const minY = Math.min(...scene.map((e) => e.y));
  const maxX = Math.max(...scene.map((e) => e.x + e.width));
  const maxY = Math.max(...scene.map((e) => e.y + e.height));

  const lines = scene.map((e) => {
    const text = e.text?.replace(/\s+/g, " ").trim();
    const empty = LABELABLE.has(e.type) && !text;
    const label = text
      ? ` "${text.slice(0, 40)}"`
      : empty
        ? " (EMPTY — label it or delete it)"
        : "";
    return `- ${e.id} (${e.type}) at (${r(e.x)},${r(e.y)}) ${r(e.width)}x${r(e.height)}${label}`;
  });

  return [
    `Current canvas — ${scene.length} elements, occupying x ${r(minX)}..${r(maxX)}, y ${r(minY)}..${r(maxY)}:`,
    lines.join("\n"),
    `Open space is below y=${r(maxY)} or right of x=${r(maxX)}. Put new work there, align it with the existing rows/columns, keep ~40px gaps, and don't overlap anything above. Fill or remove any boxes marked EMPTY.`,
  ].join("\n");
}

export async function POST(req: Request) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return new Response(JSON.stringify({ error: "ANTHROPIC_API_KEY is not set." }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }

  let body: AgentRequest;
  try {
    body = (await req.json()) as AgentRequest;
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body." }), { status: 400 });
  }

  const client = new Anthropic({ apiKey });
  const encoder = new TextEncoder();

  const history: Anthropic.MessageParam[] = (body.history ?? [])
    .filter((t) => t.text?.trim())
    .map((t) => ({ role: t.role, content: t.text }));

  const messages: Anthropic.MessageParam[] = [
    ...history,
    {
      role: "user",
      content: `${sceneToText(body.scene ?? [])}\n\n---\n${body.message}`,
    },
  ];

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: AgentEvent) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      };

      // Stays on the highest available tier once a fallback happens.
      let activeIdx = 0;
      try {
        for (let turn = 0; turn < MAX_TURNS; turn++) {
          send({ type: "status", status: "thinking" });

          const { final, idx } = await runTurn(
            client,
            activeIdx,
            { system: SYSTEM_PROMPT, tools: TOOLS, messages },
            (t) => send({ type: "text", text: t }),
            (fromLabel, toLabel) =>
              send({ type: "notice", message: `${fromLabel} is busy — switched to ${toLabel}.` }),
          );
          activeIdx = idx;
          messages.push({ role: "assistant", content: final.content });

          const toolUses = final.content.filter(
            (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
          );

          if (final.stop_reason !== "tool_use" || toolUses.length === 0) {
            break;
          }

          send({ type: "status", status: "drawing" });

          const toolResults: Anthropic.ToolResultBlockParam[] = [];
          for (const use of toolUses) {
            const input = (use.input ?? {}) as Record<string, unknown>;
            if (use.name === "draw") {
              send({
                type: "draw",
                elements: Array.isArray(input.elements) ? (input.elements as any) : [],
                note: typeof input.note === "string" ? input.note : undefined,
              });
            } else if (use.name === "update") {
              send({
                type: "update",
                patches: Array.isArray(input.patches) ? (input.patches as any) : [],
              });
            } else if (use.name === "delete") {
              send({ type: "delete", ids: Array.isArray(input.ids) ? (input.ids as any) : [] });
            }
            toolResults.push({
              type: "tool_result",
              tool_use_id: use.id,
              content: "Applied to the canvas.",
            });
          }

          messages.push({ role: "user", content: toolResults });
        }

        send({ type: "status", status: "idle" });
        send({ type: "done" });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Something went wrong.";
        send({ type: "error", message });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    },
  });
}
