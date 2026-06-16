"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
// Excalidraw 0.17 injects its own styles at runtime — no CSS import needed.

import {
  applyDelete,
  applyPatches,
  convertSkeletons,
  rerouteArrows,
  revealOrder,
  summarizeScene,
} from "@/lib/elements";
import type { AgentEvent, ChatTurn, ImageInput } from "@/lib/types";
import { AgentPanel, type ChatMessage, type SendOpts } from "@/components/AgentPanel";

const Excalidraw = dynamic(
  async () => (await import("@excalidraw/excalidraw")).Excalidraw,
  {
    ssr: false,
    loading: () => <div className="flex h-full w-full items-center justify-center text-sm text-neutral-400">Loading canvas…</div>,
  },
);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Excalidraw maps scene->screen as screenX = (sceneX + scrollX) * zoom.
function boundsOf(els: any[]) {
  return {
    minX: Math.min(...els.map((e) => e.x)),
    minY: Math.min(...els.map((e) => e.y)),
    maxX: Math.max(...els.map((e) => e.x + (e.width ?? 0))),
    maxY: Math.max(...els.map((e) => e.y + (e.height ?? 0))),
  };
}

// Fit the whole diagram in view, capped at 100% so we never zoom past real size.
function fitToContent(api: any) {
  const all = (api.getSceneElements() as any[]).filter((e) => !e.isDeleted);
  if (!all.length) return;
  const st = api.getAppState?.();
  if (!st?.width || !st?.height) return;
  const b = boundsOf(all);
  const cw = Math.max(b.maxX - b.minX, 1);
  const ch = Math.max(b.maxY - b.minY, 1);
  const pad = 100;
  let z = Math.min((st.width - pad) / cw, (st.height - pad) / ch, 1);
  if (!Number.isFinite(z) || z <= 0) z = 1;
  z = Math.max(z, 0.1);
  const cx = (b.minX + b.maxX) / 2;
  const cy = (b.minY + b.maxY) / 2;
  const scrollX = st.width / (2 * z) - cx;
  const scrollY = st.height / (2 * z) - cy;
  if (Number.isFinite(scrollX) && Number.isFinite(scrollY)) {
    api.updateScene({ appState: { scrollX, scrollY, zoom: { value: z } } });
  }
}

// After the agent draws, keep the new work in view — but only move the viewport
// when it isn't already visible, so we don't fight a human who zoomed in.
function keepInView(api: any, justAdded: any[]) {
  if (!api || !justAdded.length) return;
  const st = api.getAppState?.();
  if (!st?.width || !st?.height) return;
  const zoom = st.zoom?.value ?? 1;
  const vp = {
    minX: -st.scrollX,
    minY: -st.scrollY,
    maxX: -st.scrollX + st.width / zoom,
    maxY: -st.scrollY + st.height / zoom,
  };
  const nb = boundsOf(justAdded);
  const m = 24;
  const visible =
    nb.minX >= vp.minX + m && nb.minY >= vp.minY + m && nb.maxX <= vp.maxX - m && nb.maxY <= vp.maxY - m;
  if (visible) return;
  fitToContent(api);
}

let idCounter = 0;
const nextId = () => `m${Date.now()}_${idCounter++}`;

// Shrink a data URL to a max edge and re-encode as JPEG, so sending canvas
// images to the agent stays cheap.
function downscaleDataUrl(dataURL: string, max = 1536): Promise<ImageInput | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      const w = Math.max(1, Math.round(img.width * scale));
      const h = Math.max(1, Math.round(img.height * scale));
      const c = document.createElement("canvas");
      c.width = w;
      c.height = h;
      const ctx = c.getContext("2d");
      if (!ctx) return resolve(null);
      ctx.drawImage(img, 0, 0, w, h);
      try {
        const out = c.toDataURL("image/jpeg", 0.85);
        resolve({ mediaType: "image/jpeg", data: out.slice(out.indexOf(",") + 1) });
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = dataURL;
  });
}

// Let the agent see pictures that live on the canvas: the selected image
// elements, or — if none are selected — the most recent one. Capped + downscaled.
async function collectCanvasImages(api: any): Promise<ImageInput[]> {
  const els = (api.getSceneElements() as any[]).filter((e) => e.type === "image" && !e.isDeleted && e.fileId);
  if (!els.length) return [];
  const files = api.getFiles?.() ?? {};
  const selected = api.getAppState?.().selectedElementIds ?? {};
  const picked = els.some((e) => selected[e.id])
    ? els.filter((e) => selected[e.id])
    : [els.sort((a, b) => (b.updated ?? 0) - (a.updated ?? 0))[0]];

  const out: ImageInput[] = [];
  for (const el of picked.slice(0, 3)) {
    const url = files[el.fileId]?.dataURL;
    if (!url) continue;
    const img = await downscaleDataUrl(url);
    if (img) out.push(img);
  }
  return out;
}

export type CanvasAppProps = {
  docId: string;
  initialTitle: string;
  initialScene: any[];
  initialFiles: Record<string, any>;
  initialChat: ChatMessage[];
};

export default function CanvasApp({ docId, initialTitle, initialScene, initialFiles, initialChat }: CanvasAppProps) {
  const apiRef = useRef<any>(null);
  const fittedRef = useRef(false);
  const [messages, setMessages] = useState<ChatMessage[]>(initialChat);
  const [title, setTitle] = useState(initialTitle);
  const [status, setStatus] = useState<"idle" | "thinking" | "drawing">("idle");
  const [busy, setBusy] = useState(false);
  const [saveState, setSaveState] = useState<"saved" | "saving">("saved");

  // Latest values for the debounced save closure.
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  const titleRef = useRef(title);
  titleRef.current = title;

  const updateScene = useCallback((elements: any[]) => {
    apiRef.current?.updateScene({ elements });
  }, []);

  // ---- autosave ----
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const doSave = useCallback(async () => {
    const api = apiRef.current;
    if (!api) return;
    const scene = (api.getSceneElements() as any[]).filter((e) => !e.isDeleted);
    const files = api.getFiles?.() ?? {};
    try {
      await fetch(`/api/docs/${docId}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: titleRef.current, scene, files, chat: messagesRef.current }),
      });
    } finally {
      setSaveState("saved");
    }
  }, [docId]);

  const scheduleSave = useCallback(() => {
    setSaveState("saving");
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(doSave, 800);
  }, [doSave]);

  // Save when chat or title changes (canvas changes go through onChange below).
  useEffect(() => {
    scheduleSave();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, title]);

  // Excalidraw fires onChange constantly; reroute connected arrows, then save.
  const handleChange = useCallback(() => {
    const api = apiRef.current;
    if (api) rerouteArrows(api);
    scheduleSave();
  }, [scheduleSave]);

  const handleDraw = useCallback(
    async (skeletons: any[]) => {
      const api = apiRef.current;
      if (!api) return;
      const base = api.getSceneElements() as any[];
      const converted = await convertSkeletons(skeletons, base);
      if (!converted.length) return;
      const reveal = revealOrder(converted);
      const shown: any[] = [];
      for (const el of reveal) {
        shown.push(el);
        updateScene([...base, ...shown]);
        await sleep(90);
      }
      keepInView(api, converted);
    },
    [updateScene],
  );

  const appendAssistant = useCallback((mid: string, patch: Partial<ChatMessage>) => {
    setMessages((prev) =>
      prev.map((m) => (m.id === mid ? { ...m, ...patch, text: patch.text ?? m.text } : m)),
    );
  }, []);

  const addNote = useCallback((mid: string, note: string) => {
    setMessages((prev) =>
      prev.map((m) => (m.id === mid ? { ...m, notes: [...(m.notes ?? []), note] } : m)),
    );
  }, []);

  const send = useCallback(
    async (text: string, opts?: SendOpts) => {
      const api = apiRef.current;
      if (!api || busy) return;
      setBusy(true);

      const userMsg: ChatMessage = { id: nextId(), role: "user", text };
      const assistantId = nextId();
      const assistantMsg: ChatMessage = { id: assistantId, role: "assistant", text: "" };

      const history: ChatTurn[] = messages.map((m) => ({ role: m.role, text: m.text }));
      setMessages((prev) => [...prev, userMsg, assistantMsg]);

      const scene = summarizeScene(api.getSceneElements() as any[]);
      // Explicitly attached image + any picture(s) on the canvas the agent should see.
      const images = [...(opts?.image ? [opts.image] : []), ...(await collectCanvasImages(api))];

      let assistantText = "";
      try {
        const res = await fetch("/api/agent", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            message: text,
            history,
            scene,
            images,
            codebase: opts?.codebase,
            repoRoot: opts?.repoRoot,
          }),
        });
        if (!res.ok || !res.body) {
          const err = await res.json().catch(() => ({ error: "Request failed." }));
          throw new Error(err.error ?? "Request failed.");
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        let queue: Promise<void> = Promise.resolve();
        const enqueue = (fn: () => Promise<void>) => {
          queue = queue.then(fn).catch(() => {});
        };

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const parts = buffer.split("\n\n");
          buffer = parts.pop() ?? "";
          for (const part of parts) {
            const line = part.trim();
            if (!line.startsWith("data:")) continue;
            const event = JSON.parse(line.slice(5).trim()) as AgentEvent;

            if (event.type === "text") {
              assistantText += event.text;
              appendAssistant(assistantId, { text: assistantText });
            } else if (event.type === "status") {
              setStatus(event.status);
            } else if (event.type === "draw") {
              if (event.note) addNote(assistantId, event.note);
              enqueue(() => handleDraw(event.elements as any[]));
            } else if (event.type === "update") {
              enqueue(async () => {
                const cur = api.getSceneElements() as any[];
                updateScene(applyPatches(cur, event.patches));
              });
            } else if (event.type === "delete") {
              enqueue(async () => {
                const cur = api.getSceneElements() as any[];
                updateScene(applyDelete(cur, event.ids));
              });
            } else if (event.type === "notice") {
              addNote(assistantId, event.message);
            } else if (event.type === "error") {
              assistantText += assistantText ? `\n\n⚠ ${event.message}` : `⚠ ${event.message}`;
              appendAssistant(assistantId, { text: assistantText });
            }
          }
        }
        await queue;
      } catch (err) {
        const message = err instanceof Error ? err.message : "Something went wrong.";
        appendAssistant(assistantId, { text: assistantText ? `${assistantText}\n\n⚠ ${message}` : `⚠ ${message}` });
      } finally {
        setStatus("idle");
        setBusy(false);
      }
    },
    [addNote, appendAssistant, busy, handleDraw, messages, updateScene],
  );

  return (
    <div className="flex h-dvh w-screen flex-col overflow-hidden bg-paper">
      <header className="flex h-11 shrink-0 items-center gap-3 border-b border-line bg-white/80 px-3 backdrop-blur">
        <Link href="/" className="rounded-md px-2 py-1 text-sm text-neutral-500 transition hover:bg-neutral-100 hover:text-ink">
          ← Canvases
        </Link>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Untitled canvas"
          className="min-w-0 flex-1 bg-transparent text-sm font-medium text-ink outline-none placeholder:text-neutral-400"
        />
        <span className="text-xs text-neutral-400">{saveState === "saving" ? "Saving…" : "Saved"}</span>
      </header>

      <div className="flex flex-1 overflow-hidden">
        <div className="relative h-full flex-1">
          <Excalidraw
            excalidrawAPI={(api: any) => {
              apiRef.current = api;
              if (!fittedRef.current && initialScene.length) {
                fittedRef.current = true;
                setTimeout(() => fitToContent(api), 60);
              }
            }}
            onChange={handleChange}
            initialData={{
              elements: initialScene as any,
              files: initialFiles as any,
              appState: { viewBackgroundColor: "#f6f4ef" },
              scrollToContent: true,
            }}
          />
        </div>
        <AgentPanel messages={messages} status={status} busy={busy} onSend={send} />
      </div>
    </div>
  );
}
