"use client";

import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ArrowUp, Folder, Image as ImageIcon, X } from "lucide-react";
import type { ImageInput } from "@/lib/types";

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  notes?: string[];
};

export type SendOpts = { image?: ImageInput; repoRoot?: string };

type PendingImage = { input: ImageInput; preview: string };

function Markdown({ text }: { text: string }) {
  return (
    <div className="space-y-2 [&_a]:text-amber-700 [&_a]:underline [&_code]:rounded [&_code]:bg-neutral-100 [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-[0.85em] [&_li]:ml-4 [&_li]:list-disc [&_ol_li]:list-decimal [&_strong]:font-semibold">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
    </div>
  );
}

async function fileToImage(file: File): Promise<PendingImage> {
  const dataUrl: string = await new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result as string);
    r.onerror = rej;
    r.readAsDataURL(file);
  });
  const comma = dataUrl.indexOf(",");
  const meta = dataUrl.slice(5, dataUrl.indexOf(";")); // data:<mediaType>;base64
  return { input: { mediaType: meta, data: dataUrl.slice(comma + 1) }, preview: dataUrl };
}

const PROMPTS = [
  "Sketch the architecture for a URL shortener",
  "Lay out a 4-step launch plan",
  "Paste a sketch and I'll redraw it cleanly",
  "Diagram a local codebase folder",
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
  onSend: (text: string, opts?: SendOpts) => void;
}) {
  const [draft, setDraft] = useState("");
  const [image, setImage] = useState<PendingImage | null>(null);
  const [repoRoot, setRepoRoot] = useState<string | null>(null);
  const [folderDraft, setFolderDraft] = useState<string | null>(null); // null = editor closed
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, status]);

  const submit = () => {
    if (busy) return;
    let text = draft.trim();
    if (!text) {
      if (image) text = "Recreate this picture on the canvas, cleaned up.";
      else if (repoRoot) text = "Draw the architecture of this codebase.";
      else return;
    }
    onSend(text, { image: image?.input, repoRoot: repoRoot ?? undefined });
    setDraft("");
    setImage(null); // image is per-message; the codebase folder stays attached
  };

  const takeImageFile = async (file?: File | null) => {
    if (file && file.type.startsWith("image/")) setImage(await fileToImage(file));
  };

  const onPaste = (e: React.ClipboardEvent) => {
    const item = Array.from(e.clipboardData.items).find((i) => i.type.startsWith("image/"));
    if (item) {
      e.preventDefault();
      takeImageFile(item.getAsFile());
    }
  };

  const onDrop = (e: React.DragEvent) => {
    const file = Array.from(e.dataTransfer.files).find((f) => f.type.startsWith("image/"));
    if (file) {
      e.preventDefault();
      takeImageFile(file);
    }
  };

  const toggleFolder = () => setFolderDraft((d) => (d === null ? repoRoot ?? "" : null));
  const confirmFolder = () => {
    setRepoRoot(folderDraft && folderDraft.trim() ? folderDraft.trim() : null);
    setFolderDraft(null);
  };

  const statusLabel =
    status === "thinking" ? "thinking…" : status === "drawing" ? "drawing on the canvas…" : null;
  const canSend = !busy && (!!draft.trim() || !!image || !!repoRoot);

  return (
    <aside
      className="flex h-full w-[360px] shrink-0 flex-col border-l border-line bg-white/70 backdrop-blur"
      onDragOver={(e) => e.preventDefault()}
      onDrop={onDrop}
    >
      <header className="flex items-center gap-2 border-b border-line px-4 py-3">
        <span className="inline-block h-2.5 w-2.5 rounded-full bg-amber-500" />
        <h1 className="text-sm font-semibold tracking-tight text-ink">Canvas partner</h1>
        <span className="ml-auto text-xs text-neutral-400">co-editing</span>
      </header>

      <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
        {messages.length === 0 && (
          <div className="space-y-4 pt-6">
            <p className="text-sm leading-relaxed text-neutral-500">
              Draw whatever&apos;s on your mind. Ask me to sketch a system or a plan — or paste a
              picture of a diagram and I&apos;ll redraw it cleanly, or point me at a local code
              folder and I&apos;ll diagram its architecture.
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
            <div key={m.id} className="flex flex-col items-start gap-1.5">
              <div className="max-w-[92%] text-sm leading-relaxed text-neutral-700">
                {m.text ? <Markdown text={m.text} /> : <span className="text-neutral-300">…</span>}
              </div>
              {m.notes?.map((note, i) => (
                <div key={i} className="flex items-start gap-1.5 pl-0.5 text-xs italic text-amber-700/80">
                  <span aria-hidden>✎</span>
                  <span>{note}</span>
                </div>
              ))}
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
        {folderDraft !== null && (
          <div className="mb-2 flex items-center gap-2 rounded-lg border border-amber-300 bg-white px-2.5 py-2 ring-2 ring-amber-100">
            <Folder className="h-4 w-4 shrink-0 text-amber-500" />
            <input
              autoFocus
              value={folderDraft}
              onChange={(e) => setFolderDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  confirmFolder();
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  setFolderDraft(null);
                }
              }}
              placeholder="/path/to/your/project"
              className="min-w-0 flex-1 bg-transparent font-mono text-xs text-ink outline-none placeholder:font-sans placeholder:text-neutral-400"
            />
            <button
              onClick={confirmFolder}
              className="shrink-0 rounded-md bg-amber-500 px-2.5 py-1 text-xs font-medium text-white transition hover:bg-amber-600"
            >
              Set
            </button>
            <button onClick={() => setFolderDraft(null)} aria-label="Cancel" className="shrink-0 text-neutral-400 transition hover:text-ink">
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        {(image || (repoRoot && folderDraft === null)) && (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {image && (
              <span className="flex items-center gap-2 rounded-lg border border-line bg-white py-1 pl-1 pr-2 text-xs text-neutral-600">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={image.preview} alt="" className="h-8 w-8 rounded-md object-cover" />
                <span>Picture</span>
                <button onClick={() => setImage(null)} aria-label="Remove picture" className="text-neutral-400 transition hover:text-ink">
                  <X className="h-3.5 w-3.5" />
                </button>
              </span>
            )}
            {repoRoot && folderDraft === null && (
              <button
                onClick={toggleFolder}
                title="Edit folder"
                className="flex max-w-full items-center gap-1.5 rounded-lg border border-line bg-white py-1.5 pl-2 pr-1.5 text-xs text-neutral-600 transition hover:border-amber-300"
              >
                <Folder className="h-3.5 w-3.5 shrink-0 text-neutral-400" />
                <span className="truncate font-mono text-[11px]" title={repoRoot}>{repoRoot}</span>
                <span
                  role="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setRepoRoot(null);
                  }}
                  aria-label="Remove folder"
                  className="shrink-0 text-neutral-400 transition hover:text-ink"
                >
                  <X className="h-3.5 w-3.5" />
                </span>
              </button>
            )}
          </div>
        )}

        <div className="rounded-2xl border border-line bg-white px-3 pb-2 pt-2.5 transition focus-within:border-amber-300 focus-within:ring-2 focus-within:ring-amber-100">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onPaste={onPaste}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            rows={1}
            placeholder="Message your canvas partner…"
            className="block max-h-40 w-full resize-none bg-transparent text-sm leading-6 text-ink outline-none placeholder:text-neutral-400"
          />
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              takeImageFile(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
          <div className="mt-1 flex items-center gap-0.5">
            <button
              onClick={() => fileRef.current?.click()}
              title="Add a picture"
              aria-label="Add a picture"
              className="rounded-lg p-1.5 text-neutral-400 transition hover:bg-neutral-100 hover:text-ink"
            >
              <ImageIcon className="h-[18px] w-[18px]" />
            </button>
            <button
              onClick={toggleFolder}
              title="Diagram a local code folder"
              aria-label="Diagram a local code folder"
              className={`rounded-lg p-1.5 transition hover:bg-neutral-100 hover:text-ink ${repoRoot || folderDraft !== null ? "text-amber-600" : "text-neutral-400"}`}
            >
              <Folder className="h-[18px] w-[18px]" />
            </button>
            <div className="flex-1" />
            <button
              onClick={submit}
              disabled={!canSend}
              aria-label="Send"
              className="flex h-8 w-8 items-center justify-center rounded-full bg-amber-500 text-white transition hover:bg-amber-600 disabled:bg-neutral-200 disabled:text-neutral-400"
            >
              <ArrowUp className="h-[18px] w-[18px]" strokeWidth={2.5} />
            </button>
          </div>
        </div>
        <p className="mt-1.5 px-1 text-[11px] text-neutral-400">Enter to send · Shift+Enter for a new line</p>
      </div>
    </aside>
  );
}
