import OpenAI from "openai";
import type { LlmMessage, Provider, StreamArgs, ToolCall, ToolDef } from "./types";

function labelFor(id: string): string {
  // gpt-4o -> "GPT-4o", o3 -> "O3"
  return id.startsWith("gpt-") ? "GPT-" + id.slice(4) : id.toUpperCase();
}

function toOpenAIMessages(system: string, messages: LlmMessage[]): any[] {
  const out: any[] = [{ role: "system", content: system }];
  for (const m of messages) {
    if (m.role === "user") {
      out.push({ role: "user", content: m.content });
    } else if (m.role === "assistant") {
      const msg: any = { role: "assistant", content: m.content || null };
      if (m.toolCalls.length) {
        msg.tool_calls = m.toolCalls.map((tc) => ({
          id: tc.id,
          type: "function",
          function: { name: tc.name, arguments: JSON.stringify(tc.input) },
        }));
      }
      out.push(msg);
    } else {
      out.push({ role: "tool", tool_call_id: m.toolCallId, content: m.content });
    }
  }
  return out;
}

function safeParse(s: string): Record<string, unknown> {
  try {
    return s ? (JSON.parse(s) as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export function makeOpenAIProvider(model: string): Provider {
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  return {
    label: labelFor(model),
    name: `OpenAI ${model}`,
    async streamTurn({ system, tools, messages, onText }: StreamArgs) {
      const openaiTools = tools.map((t: ToolDef) => ({
        type: "function" as const,
        function: { name: t.name, description: t.description, parameters: t.parameters },
      }));

      const stream = await client.chat.completions.create({
        model,
        messages: toOpenAIMessages(system, messages),
        tools: openaiTools,
        tool_choice: "auto",
        stream: true,
      });

      let text = "";
      // Tool calls arrive as fragments keyed by index — accumulate name + args.
      const calls = new Map<number, { id: string; name: string; args: string }>();

      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta;
        if (delta?.content) {
          text += delta.content;
          onText(delta.content);
        }
        for (const tc of delta?.tool_calls ?? []) {
          const e = calls.get(tc.index) ?? { id: "", name: "", args: "" };
          if (tc.id) e.id = tc.id;
          if (tc.function?.name) e.name = tc.function.name;
          if (tc.function?.arguments) e.args += tc.function.arguments;
          calls.set(tc.index, e);
        }
      }

      const toolCalls: ToolCall[] = [...calls.values()]
        .filter((e) => e.name)
        .map((e) => ({ id: e.id, name: e.name, input: safeParse(e.args) }));

      return { text, toolCalls };
    },
  };
}
