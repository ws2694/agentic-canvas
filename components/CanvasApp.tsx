"use client";

import dynamic from "next/dynamic";
import { useCallback, useRef, useState } from "react";
// Excalidraw 0.17 injects its own styles at runtime — no CSS import needed.

import {
  applyDelete,
  applyPatches,
  convertSkeletons,
  revealOrder,
  summarizeScene,
} from "@/lib/elements";
import type { AgentEvent, ChatTurn } from "@/lib/types";
import { AgentPanel, type ChatMessage } from "@/components/AgentPanel";

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

// After the agent draws, keep the whole diagram in view — but only move the
// viewport when the new work isn't already visible, so we don't fight a human
// who zoomed in to focus somewhere. When we do move, fit everything (capped at
// 100% so we never zoom past real size) so nothing falls off-screen.
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
  const alreadyVisible =
    nb.minX >= vp.minX + m && nb.minY >= vp.minY + m && nb.maxX <= vp.maxX - m && nb.maxY <= vp.maxY - m;
  if (alreadyVisible) return;

  const all = (api.getSceneElements() as any[]).filter((e) => !e.isDeleted);
  if (!all.length) return;
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

let idCounter = 0;
const nextId = () => `m${Date.now()}_${idCounter++}`;

export default function CanvasApp() {
  const apiRef = useRef<any>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [status, setStatus] = useState<"idle" | "thinking" | "drawing">("idle");
  const [busy, setBusy] = useState(false);

  const updateScene = useCallback((elements: any[]) => {
    apiRef.current?.updateScene({ elements });
  }, []);

  const handleDraw = useCallback(
    async (skeletons: any[]) => {
      const api = apiRef.current;
      if (!api) return;
      const base = api.getSceneElements() as any[];
      const converted = await convertSkeletons(skeletons, base);
      if (!converted.length) return;
      const reveal = revealOrder(converted);
      // Reveal one at a time so it feels like a collaborator drawing.
      const shown: any[] = [];
      for (const el of reveal) {
        shown.push(el);
        updateScene([...base, ...shown]);
        await sleep(90);
      }
      // Keep the new work (and the rest of the diagram) in view.
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
    async (text: string) => {
      const api = apiRef.current;
      if (!api || busy) return;
      setBusy(true);

      const userMsg: ChatMessage = { id: nextId(), role: "user", text };
      const assistantId = nextId();
      const assistantMsg: ChatMessage = { id: assistantId, role: "assistant", text: "" };

      const history: ChatTurn[] = messages.map((m) => ({ role: m.role, text: m.text }));
      setMessages((prev) => [...prev, userMsg, assistantMsg]);

      const scene = summarizeScene(api.getSceneElements() as any[]);

      let assistantText = "";
      try {
        const res = await fetch("/api/agent", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ message: text, history, scene }),
        });
        if (!res.ok || !res.body) {
          const err = await res.json().catch(() => ({ error: "Request failed." }));
          throw new Error(err.error ?? "Request failed.");
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        // Keep canvas mutations in order even though events arrive fast.
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
    <div className="flex h-dvh w-screen overflow-hidden bg-paper">
      <div className="relative h-full flex-1">
        <Excalidraw
          excalidrawAPI={(api: any) => (apiRef.current = api)}
          initialData={{ appState: { viewBackgroundColor: "#f6f4ef" } }}
        />
      </div>
      <AgentPanel messages={messages} status={status} busy={busy} onSend={send} />
    </div>
  );
}
