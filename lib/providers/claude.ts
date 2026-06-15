import Anthropic from "@anthropic-ai/sdk";
import type { LlmMessage, Provider, StreamArgs, ToolCall, ToolDef } from "./types";

const THINKING_PARAMS = {
  thinking: { type: "adaptive" },
  output_config: { effort: "medium" },
};

function labelFor(id: string): string {
  if (id.includes("opus")) return "Claude Opus";
  if (id.includes("sonnet")) return "Claude Sonnet";
  if (id.includes("haiku")) return "Claude Haiku";
  return id;
}

// Anthropic needs all tool results for one assistant turn grouped into a single
// user message; our normalized history emits one per call, so we collapse them.
export function toAnthropicMessages(messages: LlmMessage[]): Anthropic.MessageParam[] {
  const out: Anthropic.MessageParam[] = [];
  for (const m of messages) {
    if (m.role === "user") {
      out.push({ role: "user", content: m.content });
    } else if (m.role === "assistant") {
      const content: any[] = [];
      if (m.content.trim()) content.push({ type: "text", text: m.content });
      for (const tc of m.toolCalls) {
        content.push({ type: "tool_use", id: tc.id, name: tc.name, input: tc.input });
      }
      out.push({ role: "assistant", content });
    } else {
      const block = { type: "tool_result", tool_use_id: m.toolCallId, content: m.content };
      const last = out[out.length - 1];
      if (last && last.role === "user" && Array.isArray(last.content)) {
        last.content.push(block as any);
      } else {
        out.push({ role: "user", content: [block as any] });
      }
    }
  }
  return out;
}

export function makeClaudeProvider(model: string): Provider {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const params = model.includes("haiku") ? {} : THINKING_PARAMS;

  return {
    label: labelFor(model),
    name: `Anthropic ${model}`,
    async streamTurn({ system, tools, messages, onText }: StreamArgs) {
      const anthropicTools = tools.map((t: ToolDef) => ({
        name: t.name,
        description: t.description,
        input_schema: t.parameters,
      }));

      const ms = client.messages.stream({
        model,
        max_tokens: 16000,
        system,
        tools: anthropicTools,
        messages: toAnthropicMessages(messages),
        ...params,
      } as any);

      ms.on("text", (delta) => {
        if (delta) onText(delta);
      });

      const final = await ms.finalMessage();
      let text = "";
      const toolCalls: ToolCall[] = [];
      for (const block of final.content) {
        if (block.type === "text") text += block.text;
        else if (block.type === "tool_use") {
          toolCalls.push({
            id: block.id,
            name: block.name,
            input: (block.input ?? {}) as Record<string, unknown>,
          });
        }
      }
      return { text, toolCalls };
    },
  };
}
