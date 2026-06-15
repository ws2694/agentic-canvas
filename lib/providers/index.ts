import { makeClaudeProvider } from "./claude";
import { makeOpenAIProvider } from "./openai";
import type { Provider } from "./types";

export type { Provider, ToolDef, ToolCall, LlmMessage, TurnResult } from "./types";
export { shouldFallback } from "./types";

function ids(env: string | undefined, fallback: string[]): string[] {
  const parsed = env?.split(",").map((s) => s.trim()).filter(Boolean);
  return parsed?.length ? parsed : fallback;
}

// The fallback chain, built from whatever providers are configured. A provider
// is only included if its API key is set, so adding OPENAI_API_KEY turns on
// cross-provider fallback without any other change. Order = preference:
// Claude tiers first, then OpenAI. Override model lists with AGENT_MODELS /
// OPENAI_MODELS (comma-separated ids).
export function buildProviders(): Provider[] {
  const providers: Provider[] = [];

  if (process.env.ANTHROPIC_API_KEY) {
    for (const id of ids(process.env.AGENT_MODELS, [
      "claude-opus-4-8",
      "claude-sonnet-4-6",
      "claude-haiku-4-5",
    ])) {
      providers.push(makeClaudeProvider(id));
    }
  }

  if (process.env.OPENAI_API_KEY) {
    for (const id of ids(process.env.OPENAI_MODELS, ["gpt-4o"])) {
      providers.push(makeOpenAIProvider(id));
    }
  }

  return providers;
}
