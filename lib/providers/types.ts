// Vendor-neutral types so the agent loop doesn't care which model provider runs
// a turn. Each provider adapts these to its own SDK.

export type ToolDef = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
};

export type ToolCall = {
  id: string;
  name: string;
  input: Record<string, unknown>;
};

export type ImagePart = { mediaType: string; data: string }; // base64

// Normalized conversation. The loop builds this; each provider converts it to
// its own message format per request (the API is stateless on both sides).
export type LlmMessage =
  | { role: "user"; content: string; images?: ImagePart[] }
  | { role: "assistant"; content: string; toolCalls: ToolCall[] }
  | { role: "tool"; toolCallId: string; content: string };

export type TurnResult = { text: string; toolCalls: ToolCall[] };

export type StreamArgs = {
  system: string;
  tools: ToolDef[];
  messages: LlmMessage[];
  onText: (delta: string) => void;
};

export interface Provider {
  label: string; // short, shown to the user on a fallback ("Claude Opus", "GPT-4o")
  name: string; // for logs
  streamTurn(args: StreamArgs): Promise<TurnResult>;
}

// Should we fall forward to the next provider? True for "this backend is
// unavailable / limited" — rate limits, overload, transient 5xx, and
// account-level credit/quota/auth failures. Not for a genuine bad-request bug,
// which would just fail on every backend anyway.
export function shouldFallback(err: unknown): boolean {
  const e = err as { status?: number; message?: string } | null;
  const status = e?.status ?? 0;
  const msg = String(e?.message ?? "");
  if ([429, 500, 502, 503, 529].includes(status)) return true;
  if (
    [400, 401, 402, 403].includes(status) &&
    /credit|billing|quota|insufficient|exceed|balance|payment|limit/i.test(msg)
  ) {
    return true;
  }
  return false;
}
