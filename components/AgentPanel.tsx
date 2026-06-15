"use client";

import { useEffect, useRef, useState } from "react";

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
};

const PROMPTS = [
  "Sketch the architecture for a URL shortener",
  "Lay out a 4-step launch plan",
  "Add a caching layer to what I drew",
  "What's missing from this design?",
];

export function AgentPanel({
  messages,
  status,
  busy,
  onSend,
}: {
  messages: ChatMessage[];
  status: "idle" | "thinking" | "drawing";
  busy: boolean;
  onSend: (text: string) => void;
}) {
  const [draft, setDraft] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, status]);

  const submit = () => {
    const text = draft.trim();
    if (!text || busy) return;
    setDraft("");
    onSend(text);
  };

  const statusLabel =
    status === "thinking" ? "thinking…" : status === "drawing" ? "drawing on the canvas…" : null;

  return (
    <aside className="flex h-full w-[360px] shrink-0 flex-col border-l border-line bg-white/70 backdrop-blur">
      <header className="flex items-center gap-2 border-b border-line px-4 py-3">
        <span className="inline-block h-2.5 w-2.5 rounded-full bg-amber-500" />
        <h1 className="text-sm font-semibold tracking-tight text-ink">Canvas partner</h1>
        <span className="ml-auto text-xs text-neutral-400">co-editing</span>
      </header>

      <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
        {messages.length === 0 && (
          <div className="space-y-4 pt-6">
            <p className="text-sm leading-relaxed text-neutral-500">
              Draw whatever&apos;s on your mind. Ask me to sketch a system, lay out a plan, or fill
              in the part you haven&apos;t figured out yet — I&apos;ll draw it right on the canvas
              with you.
            </p>
            <div className="space-y-2">
              {PROMPTS.map((p) => (
                <button
                  key={p}
                  onClick={() => onSend(p)}
                  disabled={busy}
                  className="block w-full rounded-lg border border-line bg-white px-3 py-2 text-left text-sm text-neutral-600 transition hover:border-amber-300 hover:text-ink disabled:opacity-50"
                >
                  {p}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m) =>
          m.role === "user" ? (
            <div key={m.id} className="flex justify-end">
              <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-sm bg-ink px-3.5 py-2 text-sm text-paper">
                {m.text}
              </div>
            </div>
          ) : (
            <div key={m.id} className="flex justify-start">
              <div className="max-w-[90%] whitespace-pre-wrap text-sm leading-relaxed text-neutral-700">
                {m.text || <span className="text-neutral-300">…</span>}
              </div>
            </div>
          ),
        )}

        {statusLabel && (
          <div className="flex items-center gap-2 text-xs text-amber-600">
            <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-amber-500" />
            {statusLabel}
          </div>
        )}
      </div>

      <div className="border-t border-line p-3">
        <div className="flex items-end gap-2 rounded-xl border border-line bg-white px-3 py-2 focus-within:border-amber-300">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            rows={1}
            placeholder="Message your canvas partner…"
            className="max-h-32 flex-1 resize-none bg-transparent text-sm text-ink outline-none placeholder:text-neutral-400"
          />
          <button
            onClick={submit}
            disabled={busy || !draft.trim()}
            className="rounded-lg bg-amber-500 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-amber-600 disabled:opacity-40"
          >
            Send
          </button>
        </div>
        <p className="mt-1.5 px-1 text-[11px] text-neutral-400">
          Enter to send · Shift+Enter for a new line
        </p>
      </div>
    </aside>
  );
}
