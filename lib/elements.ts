// Client-only helpers. We dynamically import @excalidraw/excalidraw so nothing
// touches `window` during the server build.

import type { ElementPatch, SceneItem, SkeletonElement } from "@/lib/types";

type AnyElement = Record<string, any>;

// Turn the agent's loose skeletons into real Excalidraw elements. Bindings
// (arrow start/end -> shape id) resolve when the batch is converted together.
export async function convertSkeletons(skeletons: SkeletonElement[]): Promise<AnyElement[]> {
  const { convertToExcalidrawElements } = await import("@excalidraw/excalidraw");
  const clean = skeletons.filter(Boolean).map(normalize);
  try {
    return convertToExcalidrawElements(clean as any) as AnyElement[];
  } catch {
    // One bad element shouldn't drop the whole batch — convert what we can.
    const out: AnyElement[] = [];
    for (const s of clean) {
      try {
        out.push(...(convertToExcalidrawElements([s] as any) as AnyElement[]));
      } catch {
        /* skip */
      }
    }
    return out;
  }
}

function normalize(s: SkeletonElement): SkeletonElement {
  const out: SkeletonElement = { ...s };
  // Excalidraw treats text as a label on shapes via `label`, but a bare `text`
  // element uses `text`. Keep `text` for text elements; for shapes, the skeleton
  // API accepts `label: { text }`.
  if (s.type !== "text" && typeof s.text === "string") {
    (out as AnyElement).label = { text: s.text };
    delete (out as AnyElement).text;
  }
  if (out.backgroundColor === "transparent") delete (out as AnyElement).backgroundColor;
  return out;
}

// Order so containers/shapes are revealed before the arrows that bind to them.
export function revealOrder(elements: AnyElement[]): AnyElement[] {
  const weight = (t: string) => (t === "arrow" || t === "line" ? 1 : 0);
  return [...elements].sort((a, b) => weight(a.type) - weight(b.type));
}

export function applyPatches(elements: readonly AnyElement[], patches: ElementPatch[]): AnyElement[] {
  const byId = new Map(patches.map((p) => [p.id, p]));
  return elements.map((el) => {
    const p = byId.get(el.id);
    if (!p) return el;
    const next: AnyElement = { ...el };
    if (typeof p.x === "number") next.x = p.x;
    if (typeof p.y === "number") next.y = p.y;
    if (typeof p.width === "number") next.width = p.width;
    if (typeof p.height === "number") next.height = p.height;
    if (typeof p.strokeColor === "string") next.strokeColor = p.strokeColor;
    if (typeof p.backgroundColor === "string")
      next.backgroundColor = p.backgroundColor === "transparent" ? "transparent" : p.backgroundColor;
    if (typeof p.text === "string" && el.type === "text") {
      next.text = p.text;
      next.originalText = p.text;
    }
    next.version = (el.version ?? 1) + 1;
    return next;
  });
}

export function applyDelete(elements: readonly AnyElement[], ids: string[]): AnyElement[] {
  const drop = new Set(ids);
  // Also drop text bound to a deleted container.
  for (const el of elements) {
    if (drop.has(el.id) && Array.isArray(el.boundElements)) {
      for (const b of el.boundElements) if (b?.id) drop.add(b.id);
    }
  }
  return elements.filter((el) => !drop.has(el.id));
}

// Compact, agent-friendly summary of what's on the canvas right now.
export function summarizeScene(elements: readonly AnyElement[]): SceneItem[] {
  const textById = new Map<string, string>();
  for (const el of elements) {
    if (el.type === "text" && el.containerId) textById.set(el.containerId, el.text ?? "");
  }
  return elements
    .filter((el) => !el.isDeleted && el.type !== "text" || (el.type === "text" && !el.containerId))
    .map((el) => ({
      id: el.id,
      type: el.type,
      x: el.x ?? 0,
      y: el.y ?? 0,
      width: el.width ?? 0,
      height: el.height ?? 0,
      text: el.type === "text" ? el.text : textById.get(el.id),
    }))
    .filter((it) => it.id);
}
