import { SYSTEM_PROMPT, TOOLS } from "@/lib/agent";
import { buildProviders, shouldFallback } from "@/lib/providers";
import type { LlmMessage, Provider, ToolCall, TurnResult } from "@/lib/providers";
import type { AgentEvent, AgentRequest, SceneItem } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 120;

const MAX_TURNS = 8;

// Run one turn, falling forward through the provider chain when a backend is
// limited/unavailable. Returns the chosen provider index so the caller can stay
// there for later turns.
async function runTurn(
  providers: Provider[],
  startIdx: number,
  base: { messages: LlmMessage[]; onText: (t: string) => void },
  onFallback: (fromLabel: string, toLabel: string) => void,
): Promise<{ result: TurnResult; idx: number }> {
  let lastErr: unknown;
  for (let i = startIdx; i < providers.length; i++) {
    const provider = providers[i];
    let produced = false;
    try {
      const result = await provider.streamTurn({
        system: SYSTEM_PROMPT,
        tools: TOOLS,
        messages: base.messages,
        onText: (delta) => {
          produced = true;
          base.onText(delta);
        },
      });
      return { result, idx: i };
    } catch (err) {
      lastErr = err;
      // Only fall back before any text streamed (avoids duplicated output) and
      // only when the backend looks unavailable, not on a genuine request bug.
      if (!produced && shouldFallback(err) && i + 1 < providers.length) {
        onFallback(provider.label, providers[i + 1].label);
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
  const providers = buildProviders();
  if (!providers.length) {
    return new Response(
      JSON.stringify({ error: "No model provider configured. Set ANTHROPIC_API_KEY and/or OPENAI_API_KEY." }),
      { status: 500, headers: { "content-type": "application/json" } },
    );
  }

  let body: AgentRequest;
  try {
    body = (await req.json()) as AgentRequest;
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body." }), { status: 400 });
  }

  const encoder = new TextEncoder();

  // Normalized conversation: prior text turns + the new turn with scene context.
  const messages: LlmMessage[] = (body.history ?? [])
    .filter((t) => t.text?.trim())
    .map((t) =>
      t.role === "assistant"
        ? { role: "assistant", content: t.text, toolCalls: [] }
        : { role: "user", content: t.text },
    );
  messages.push({
    role: "user",
    content: `${sceneToText(body.scene ?? [])}\n\n---\n${body.message}`,
  });

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: AgentEvent) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      };

      // Stays on the highest available provider once a fallback happens.
      let activeIdx = 0;
      try {
        for (let turn = 0; turn < MAX_TURNS; turn++) {
          send({ type: "status", status: "thinking" });

          const { result, idx } = await runTurn(
            providers,
            activeIdx,
            { messages, onText: (t) => send({ type: "text", text: t }) },
            (fromLabel, toLabel) =>
              send({ type: "notice", message: `${fromLabel} is busy — switched to ${toLabel}.` }),
          );
          activeIdx = idx;
          messages.push({ role: "assistant", content: result.text, toolCalls: result.toolCalls });

          if (!result.toolCalls.length) break;

          send({ type: "status", status: "drawing" });

          for (const call of result.toolCalls) {
            dispatchToolCall(call, send);
            messages.push({ role: "tool", toolCallId: call.id, content: "Applied to the canvas." });
          }
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

function dispatchToolCall(call: ToolCall, send: (e: AgentEvent) => void) {
  const input = call.input ?? {};
  if (call.name === "draw") {
    send({
      type: "draw",
      elements: Array.isArray(input.elements) ? (input.elements as any) : [],
      note: typeof input.note === "string" ? input.note : undefined,
    });
  } else if (call.name === "update") {
    send({ type: "update", patches: Array.isArray(input.patches) ? (input.patches as any) : [] });
  } else if (call.name === "delete") {
    send({ type: "delete", ids: Array.isArray(input.ids) ? (input.ids as any) : [] });
  }
}
