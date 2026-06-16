import { CODEBASE_TOOLS, SYSTEM_PROMPT, TOOLS } from "@/lib/agent";
import { CODEBASE_TOOL_NAMES, codebaseAllowed, rootExists, runCodebaseTool } from "@/lib/codebase";
import { buildProviders, shouldFallback } from "@/lib/providers";
import type { LlmMessage, Provider, ToolCall, ToolDef, TurnResult } from "@/lib/providers";
import { sceneToText } from "@/lib/scene";
import type { AgentEvent, AgentRequest, CodebaseSnapshot } from "@/lib/types";

function codebaseToText(cb: CodebaseSnapshot): string {
  const tree = cb.tree.join("\n");
  const files = cb.files.map((f) => `### ${f.path}\n\`\`\`\n${f.content}\n\`\`\``).join("\n\n");
  return `A codebase "${cb.name}" is attached — study it and draw its architecture (real components, how they depend on each other, grouped by layer).\n\nFile tree:\n${tree}\n\n--- key files ---\n${files}`;
}

export const runtime = "nodejs";
export const maxDuration = 120;

// Run one turn, falling forward through the provider chain when a backend is
// limited/unavailable. Returns the chosen provider index so the caller can stay
// there for later turns.
async function runTurn(
  providers: Provider[],
  startIdx: number,
  base: { messages: LlmMessage[]; tools: ToolDef[]; onText: (t: string) => void },
  onFallback: (fromLabel: string, toLabel: string) => void,
): Promise<{ result: TurnResult; idx: number }> {
  let lastErr: unknown;
  for (let i = startIdx; i < providers.length; i++) {
    const provider = providers[i];
    let produced = false;
    try {
      const result = await provider.streamTurn({
        system: SYSTEM_PROMPT,
        tools: base.tools,
        messages: base.messages,
        onText: (delta) => {
          produced = true;
          base.onText(delta);
        },
      });
      return { result, idx: i };
    } catch (err) {
      lastErr = err;
      if (!produced && shouldFallback(err) && i + 1 < providers.length) {
        onFallback(provider.label, providers[i + 1].label);
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
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

  // Codebase: a browser-read snapshot is injected as context. The typed-path
  // fallback reads the server filesystem via tools (local only).
  const codebase = body.codebase;
  const repoRoot = body.repoRoot?.trim();
  const useServerCodebase = !codebase && !!repoRoot && codebaseAllowed() && (await rootExists(repoRoot));
  const tools: ToolDef[] = useServerCodebase ? [...TOOLS, ...CODEBASE_TOOLS] : TOOLS;
  // The server-read path needs round-trips to read files before drawing.
  const maxTurns = useServerCodebase ? 24 : 8;

  const encoder = new TextEncoder();

  // Normalized conversation: prior text turns + the new turn with scene context.
  const messages: LlmMessage[] = (body.history ?? [])
    .filter((t) => t.text?.trim())
    .map((t) =>
      t.role === "assistant"
        ? { role: "assistant", content: t.text, toolCalls: [] }
        : { role: "user", content: t.text },
    );

  let prompt = `${sceneToText(body.scene ?? [])}\n\n---\n${body.message}`;
  if (codebase) prompt += `\n\n${codebaseToText(codebase)}`;
  else if (useServerCodebase) prompt += `\n\n[A local codebase is attached at ${repoRoot}. Explore it with list_dir / read_file, then draw its architecture.]`;
  if (body.images?.length) prompt += `\n\n[${body.images.length} image(s) are attached below for this request — look at them.]`;
  messages.push({ role: "user", content: prompt, images: body.images });

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: AgentEvent) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      };

      let activeIdx = 0;
      let announcedReading = false;
      try {
        for (let turn = 0; turn < maxTurns; turn++) {
          send({ type: "status", status: "thinking" });

          const { result, idx } = await runTurn(
            providers,
            activeIdx,
            { messages, tools, onText: (t) => send({ type: "text", text: t }) },
            (fromLabel, toLabel) =>
              send({ type: "notice", message: `${fromLabel} is busy — switched to ${toLabel}.` }),
          );
          activeIdx = idx;
          messages.push({ role: "assistant", content: result.text, toolCalls: result.toolCalls });

          if (!result.toolCalls.length) break;

          const drawing = result.toolCalls.some((c) => !CODEBASE_TOOL_NAMES.has(c.name));
          if (drawing) send({ type: "status", status: "drawing" });

          for (const call of result.toolCalls) {
            const resultText = await handleToolCall(call, repoRoot, useServerCodebase, send, () => {
              if (!announcedReading) {
                announcedReading = true;
                send({ type: "notice", message: "Reading the codebase…" });
              }
            });
            messages.push({ role: "tool", toolCallId: call.id, content: resultText });
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

// Canvas tools are applied on the client (forwarded over SSE); codebase tools
// run here on the server and feed their output back to the model.
async function handleToolCall(
  call: ToolCall,
  repoRoot: string | undefined,
  useCodebase: boolean,
  send: (e: AgentEvent) => void,
  onCodebaseRead: () => void,
): Promise<string> {
  const input = (call.input ?? {}) as Record<string, unknown>;

  if (CODEBASE_TOOL_NAMES.has(call.name)) {
    if (!useCodebase || !repoRoot) return "No codebase is attached.";
    onCodebaseRead();
    return runCodebaseTool(call.name, input, repoRoot);
  }

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
  return "Applied to the canvas.";
}
