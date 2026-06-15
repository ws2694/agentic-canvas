import Anthropic from "@anthropic-ai/sdk";
import { MODEL, SYSTEM_PROMPT, TOOLS } from "@/lib/agent";
import type { AgentEvent, AgentRequest, SceneItem } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 120;

const MAX_TURNS = 8;

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

      try {
        for (let turn = 0; turn < MAX_TURNS; turn++) {
          send({ type: "status", status: "thinking" });

          const ms = client.messages.stream({
            model: MODEL,
            max_tokens: 16000,
            // Adaptive thinking is the correct mode for Opus 4.8; medium effort
            // keeps the co-editing loop snappy (less up-front thinking before the
            // first token). The 0.68 SDK types lag the API, so cast the params.
            thinking: { type: "adaptive" },
            output_config: { effort: "medium" },
            system: SYSTEM_PROMPT,
            tools: TOOLS,
            messages,
          } as any);

          ms.on("text", (delta) => {
            if (delta) send({ type: "text", text: delta });
          });

          const final = await ms.finalMessage();
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
