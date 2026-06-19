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
import { buildBriefMarkdown, slugify } from "@/lib/export";
import { Download, History, PanelRightClose, PanelRightOpen } from "lucide-react";
import type { DocVersionMeta } from "@/lib/store/types";

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

function ago(iso: string): string {
  const s = Math.max(1, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return new Date(iso).toLocaleString();
}

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
  // Becomes true once the canvas has actually shown content this session, so we
  // can tell a real "user cleared it" from "the initial scene hasn't loaded yet".
  const loadedNonEmptyRef = useRef(false);
  const [messages, setMessages] = useState<ChatMessage[]>(initialChat);
  const [title, setTitle] = useState(initialTitle);
  const [status, setStatus] = useState<"idle" | "thinking" | "drawing">("idle");
  const [busy, setBusy] = useState(false);
  const [saveState, setSaveState] = useState<"saved" | "saving">("saved");
  const [exporting, setExporting] = useState(false);
  const [panelOpen, setPanelOpen] = useState(true);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [versions, setVersions] = useState<DocVersionMeta[]>([]);

  // Latest values for the debounced save closure.
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  const titleRef = useRef(title);
  titleRef.current = title;

  const updateScene = useCallback((elements: any[]) => {
    apiRef.current?.updateScene({ elements });
  }, []);

  const openHistory = useCallback(async () => {
    try {
      const res = await fetch(`/api/docs/${docId}/versions`);
      const data = await res.json();
      setVersions(data.versions ?? []);
    } catch {
      setVersions([]);
    }
    setHistoryOpen(true);
  }, [docId]);

  const restoreVersion = useCallback(
    async (versionId: string) => {
      await fetch(`/api/docs/${docId}/versions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ versionId }),
      });
      // Reload so the canvas mounts with the restored scene.
      window.location.reload();
    },
    [docId],
  );

  // Export a handoff bundle: BRIEF.md (the conversation) + canvas.png (the
  // diagram), zipped — drop it into a repo for Claude Code / Codex.
  const exportDesign = useCallback(async () => {
    const api = apiRef.current;
    if (!api || exporting) return;
    setExporting(true);
    try {
      const elements = (api.getSceneElements() as any[]).filter((e) => !e.isDeleted);
      const [excalidraw, jszip] = await Promise.all([
        import("@excalidraw/excalidraw"),
        import("jszip"),
      ]);
      const JSZip = (jszip as any).default ?? jszip;

      // exportToBlob waits on font loading and can stall; never let it hang the
      // button — race it against a timeout and fall back to a brief-only export.
      let png: Blob | null = null;
      if (elements.length) {
        const render = (excalidraw as any)
          .exportToBlob({
            elements,
            files: api.getFiles?.() ?? null,
            mimeType: "image/png",
            exportPadding: 24,
            appState: { exportBackground: true, viewBackgroundColor: "#f6f4ef", exportScale: 2 },
          })
          .catch(() => null);
        png = await Promise.race([
          render,
          new Promise<null>((r) => setTimeout(() => r(null), 12000)),
        ]);
      }

      let md = buildBriefMarkdown(titleRef.current, messagesRef.current);
      if (elements.length && !png) {
        md += "\n_(The diagram image couldn't be rendered for export — open the canvas to view it.)_\n";
      }

      const zip = new JSZip();
      zip.file("BRIEF.md", md);
      if (png) zip.file("canvas.png", png);
      const blob = await zip.generateAsync({ type: "blob" });

      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${slugify(titleRef.current)}.zip`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("[canvas] export failed:", err);
    } finally {
      setExporting(false);
    }
  }, [exporting]);

  // ---- autosave ----
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const doSave = useCallback(async () => {
    const api = apiRef.current;
    if (!api) return;
    const scene = (api.getSceneElements() as any[]).filter((e) => !e.isDeleted);
    if (scene.length > 0) loadedNonEmptyRef.current = true;

    // Guard against the load race: if the canvas reads empty but the doc was
    // opened with content we've never seen rendered, the initial scene just
    // hasn't loaded — DON'T overwrite the saved scene/files with emptiness.
    // Still persist title/chat so those aren't lost.
    const sceneSafe = !(scene.length === 0 && initialScene.length > 0 && !loadedNonEmptyRef.current);

    const body: Record<string, unknown> = { title: titleRef.current, chat: messagesRef.current };
    if (sceneSafe) {
      body.scene = scene;
      body.files = api.getFiles?.() ?? {};
    }

    try {
      await fetch(`/api/docs/${docId}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
    } finally {
      setSaveState("saved");
    }
  }, [docId, initialScene.length]);

  const scheduleSave = useCallback(() => {
    setSaveState("saving");
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(doSave, 800);
  }, [doSave]);

  // Save when chat or title changes. Skip the initial mount run — there's nothing
  // to save yet, and firing a save before the canvas has loaded is what let an
  // empty scene clobber a saved one.
  const didMountRef = useRef(false);
  useEffect(() => {
    if (!didMountRef.current) {
      didMountRef.current = true;
      return;
    }
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
        <button
          onClick={openHistory}
          title="Version history"
          aria-label="Version history"
          className="rounded-md p-1.5 text-neutral-400 transition hover:bg-neutral-100 hover:text-ink"
        >
          <History className="h-4 w-4" />
        </button>
        <button
          onClick={exportDesign}
          disabled={exporting}
          title="Export the brief + diagram (for Claude Code / Codex)"
          className="flex items-center gap-1.5 rounded-md px-2 py-1 text-sm text-neutral-500 transition hover:bg-neutral-100 hover:text-ink disabled:opacity-50"
        >
          <Download className="h-4 w-4" />
          {exporting ? "Exporting…" : "Export"}
        </button>
        <span className="text-xs text-neutral-400">{saveState === "saving" ? "Saving…" : "Saved"}</span>
        <button
          onClick={() => setPanelOpen((o) => !o)}
          title={panelOpen ? "Hide chat" : "Show chat"}
          aria-label={panelOpen ? "Hide chat" : "Show chat"}
          className="rounded-md p-1.5 text-neutral-400 transition hover:bg-neutral-100 hover:text-ink"
        >
          {panelOpen ? <PanelRightClose className="h-4 w-4" /> : <PanelRightOpen className="h-4 w-4" />}
        </button>
      </header>

      {historyOpen && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setHistoryOpen(false)} />
          <div className="fixed right-2 top-12 z-40 w-72 overflow-hidden rounded-xl border border-line bg-white shadow-lg">
            <div className="border-b border-line px-3 py-2 text-xs font-medium text-neutral-500">
              Version history
            </div>
            {versions.length === 0 ? (
              <p className="px-3 py-4 text-sm text-neutral-400">No earlier versions yet — they accrue as you edit.</p>
            ) : (
              <ul className="max-h-80 overflow-y-auto py-1">
                {versions.map((v) => (
                  <li key={v.id} className="flex items-center justify-between gap-2 px-3 py-1.5 hover:bg-paper/60">
                    <span className="text-sm text-neutral-600">
                      {v.count} element{v.count === 1 ? "" : "s"}
                      <span className="text-neutral-400"> · {ago(v.savedAt)}</span>
                    </span>
                    <button
                      onClick={() => restoreVersion(v.id)}
                      className="shrink-0 rounded-md px-2 py-0.5 text-xs font-medium text-amber-600 transition hover:bg-amber-50"
                    >
                      Restore
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}

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
        {/* Kept mounted while hidden so the draft and attachments survive a collapse. */}
        <div className={panelOpen ? "flex h-full" : "hidden"}>
          <AgentPanel
            messages={messages}
            status={status}
            busy={busy}
            onSend={send}
            onCollapse={() => setPanelOpen(false)}
          />
        </div>
      </div>
    </div>
  );
}
