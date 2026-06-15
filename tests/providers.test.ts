import { describe, expect, it } from "vitest";
import { toAnthropicMessages } from "@/lib/providers/claude";
import { toOpenAIMessages } from "@/lib/providers/openai";
import type { LlmMessage } from "@/lib/providers/types";

const convo: LlmMessage[] = [
  { role: "user", content: "draw a box" },
  { role: "assistant", content: "ok", toolCalls: [{ id: "c1", name: "draw", input: { elements: [] } }] },
  { role: "tool", toolCallId: "c1", content: "Applied to the canvas." },
];

describe("toAnthropicMessages", () => {
  it("maps user/assistant(tool_use)/tool_result and pairs ids", () => {
    const out = toAnthropicMessages(convo) as any[];
    expect(out[0]).toEqual({ role: "user", content: "draw a box" });

    expect(out[1].role).toBe("assistant");
    expect(out[1].content).toEqual([
      { type: "text", text: "ok" },
      { type: "tool_use", id: "c1", name: "draw", input: { elements: [] } },
    ]);

    expect(out[2].role).toBe("user");
    expect(out[2].content[0]).toEqual({ type: "tool_result", tool_use_id: "c1", content: "Applied to the canvas." });
  });

  it("groups consecutive tool results into one user message", () => {
    const out = toAnthropicMessages([
      { role: "assistant", content: "", toolCalls: [{ id: "c1", name: "draw", input: {} }, { id: "c2", name: "draw", input: {} }] },
      { role: "tool", toolCallId: "c1", content: "ok1" },
      { role: "tool", toolCallId: "c2", content: "ok2" },
    ]) as any[];
    // assistant has no text -> content is tool_use blocks only
    expect(out[0].content).toHaveLength(2);
    // both tool results land in a single trailing user message
    expect(out[1].role).toBe("user");
    expect(out[1].content).toHaveLength(2);
    expect(out[1].content.map((b: any) => b.tool_use_id)).toEqual(["c1", "c2"]);
  });
});

describe("toOpenAIMessages", () => {
  it("puts system first and maps tool_calls + tool role", () => {
    const out = toOpenAIMessages("SYS", convo);
    expect(out[0]).toEqual({ role: "system", content: "SYS" });
    expect(out[1]).toEqual({ role: "user", content: "draw a box" });

    expect(out[2].role).toBe("assistant");
    expect(out[2].tool_calls).toEqual([
      { id: "c1", type: "function", function: { name: "draw", arguments: JSON.stringify({ elements: [] }) } },
    ]);

    expect(out[3]).toEqual({ role: "tool", tool_call_id: "c1", content: "Applied to the canvas." });
  });

  it("omits tool_calls when the assistant made none", () => {
    const out = toOpenAIMessages("SYS", [{ role: "assistant", content: "hi", toolCalls: [] }]);
    expect(out[1].tool_calls).toBeUndefined();
  });
});
