// Client-only helpers. We dynamically import @excalidraw/excalidraw so nothing
// touches `window` during the server build.

import type { ElementPatch, SceneItem, SkeletonElement } from "@/lib/types";
import { center, edgePoint, withArrowGeometry, type AnyElement } from "@/lib/geometry";

// Turn the agent's loose skeletons into real Excalidraw elements. Arrows resolve
// their endpoints against both this batch and whatever is already on the canvas
// (`existing`), so the agent can wire up boxes it drew in earlier turns.
export async function convertSkeletons(
  skeletons: SkeletonElement[],
  existing: AnyElement[] = [],
): Promise<AnyElement[]> {
  const { convertToExcalidrawElements } = await import("@excalidraw/excalidraw");

  // Lookup of connectable shapes by id: existing canvas first, then this batch.
  const shapes = new Map<string, AnyElement>();
  for (const e of existing) {
    if (e?.id && e.type !== "arrow" && e.type !== "line" && e.type !== "text" && !e.isDeleted) {
      shapes.set(e.id, e);
    }
  }
  for (const s of skeletons) {
    if (s.id && s.type !== "arrow" && s.type !== "line") shapes.set(s.id, s as AnyElement);
  }

  const clean = withArrowGeometry(skeletons.filter(Boolean), shapes).map(normalize);
  try {
    return convertToExcalidrawElements(clean as any) as AnyElement[];
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("[canvas] batch convert failed, falling back:", err);
    // One bad element shouldn't drop the whole batch — convert what we can.
    const out: AnyElement[] = [];
    for (const s of clean) {
      try {
        out.push(...(convertToExcalidrawElements([s] as any) as AnyElement[]));
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn("[canvas] dropped element:", s.type, s.id, e);
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

// Arrows carry customData.{from,to} (the ids of the shapes they link). When a
// box moves, recompute the connected arrows' endpoints (edge-to-edge) and push
// the update. Returns true if anything moved. Stable across repeat calls — if
// nothing moved, the recomputed endpoints match and we don't update, so this is
// safe to call on every Excalidraw onChange.
export function rerouteArrows(api: any): boolean {
  const els = api.getSceneElements() as AnyElement[];
  const byId = new Map(els.map((e) => [e.id, e]));
  let changed = false;

  const next = els.map((el) => {
    if (el.type !== "arrow" && el.type !== "line") return el;
    const link = el.customData as { from?: string; to?: string } | undefined;
    if (!link?.from || !link?.to) return el;
    const from = byId.get(link.from);
    const to = byId.get(link.to);
    if (!from || !to || from.isDeleted || to.isDeleted) return el;

    const p1 = edgePoint(from, center(to));
    const p2 = edgePoint(to, center(from));
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;

    const pts = el.points as [number, number][] | undefined;
    const lastX = el.x + (pts?.[pts.length - 1]?.[0] ?? el.width ?? 0);
    const lastY = el.y + (pts?.[pts.length - 1]?.[1] ?? el.height ?? 0);
    const moved =
      Math.abs(el.x - p1.x) > 0.5 ||
      Math.abs(el.y - p1.y) > 0.5 ||
      Math.abs(lastX - p2.x) > 0.5 ||
      Math.abs(lastY - p2.y) > 0.5;
    if (!moved) return el;

    changed = true;
    return {
      ...el,
      x: p1.x,
      y: p1.y,
      width: Math.abs(dx),
      height: Math.abs(dy),
      points: [
        [0, 0],
        [dx, dy],
      ],
      version: (el.version ?? 1) + 1,
    };
  });

  if (changed) api.updateScene({ elements: next });
  return changed;
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
    .filter((el) => el.id && !el.isDeleted)
    // Drop text that's bound to a shape — its label is folded into the shape.
    .filter((el) => el.type !== "text" || !el.containerId)
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
