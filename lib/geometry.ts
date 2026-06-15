// Pure diagram geometry — no Excalidraw import, so it's unit-testable on its own.

import type { SkeletonElement } from "@/lib/types";

export type AnyElement = Record<string, any>;
export type Pt = { x: number; y: number };

export function center(s: AnyElement): Pt {
  return { x: s.x + (s.width ?? 100) / 2, y: s.y + (s.height ?? 60) / 2 };
}

// Point on a shape's boundary along the ray from its center toward `toward`,
// pushed out by a small gap so the arrowhead doesn't touch the box.
export function edgePoint(s: AnyElement, toward: Pt, gap = 6): Pt {
  const c = center(s);
  const dx = toward.x - c.x;
  const dy = toward.y - c.y;
  if (dx === 0 && dy === 0) return c;
  const hw = (s.width ?? 100) / 2;
  const hh = (s.height ?? 60) / 2;
  const tx = dx !== 0 ? hw / Math.abs(dx) : Infinity;
  const ty = dy !== 0 ? hh / Math.abs(dy) : Infinity;
  const t = Math.min(tx, ty);
  const len = Math.hypot(dx, dy);
  const g = len ? gap / len : 0;
  return { x: c.x + dx * (t + g), y: c.y + dy * (t + g) };
}

// An arrow that carries only `start`/`end` references has no geometry, so
// Excalidraw renders it zero-length (invisible) — and `start.id`/`end.id` only
// bind to shapes inside the same convert batch, never to existing canvas shapes.
// So we resolve endpoints ourselves (edge-to-edge between the linked shapes) and
// drop the binding refs, emitting a plain arrow with explicit geometry that
// always renders, whether the boxes were drawn this turn or earlier. The linked
// ids are recorded in customData so rerouteArrows can follow the shapes later.
export function withArrowGeometry(
  skeletons: SkeletonElement[],
  shapes: Map<string, AnyElement>,
): SkeletonElement[] {
  const fixedPoint = (ref?: { id?: string; x?: number; y?: number }): Pt | null =>
    ref && typeof ref.x === "number" && typeof ref.y === "number" ? { x: ref.x, y: ref.y } : null;
  const shapeOf = (ref?: { id?: string }) =>
    ref?.id && shapes.has(ref.id) ? shapes.get(ref.id)! : null;

  return skeletons.map((s) => {
    if (s.type !== "arrow" && s.type !== "line") return s;

    const startShape = shapeOf(s.start);
    const endShape = shapeOf(s.end);
    const startTarget = endShape ? center(endShape) : fixedPoint(s.end);
    const endTarget = startShape ? center(startShape) : fixedPoint(s.start);

    const p1 =
      fixedPoint(s.start) ?? (startShape && startTarget ? edgePoint(startShape, startTarget) : null);
    const p2 =
      fixedPoint(s.end) ?? (endShape && endTarget ? edgePoint(endShape, endTarget) : null);

    // Strip the binding refs either way — they can't bind across batches.
    const { start, end, ...rest } = s;
    const hasGeometry =
      Array.isArray((rest as AnyElement).points) ||
      (typeof rest.width === "number" && typeof rest.height === "number" && (rest.width || rest.height));

    if (p1 && p2) {
      const out: AnyElement = { ...rest, x: p1.x, y: p1.y, width: p2.x - p1.x, height: p2.y - p1.y };
      if (s.start?.id && s.end?.id) out.customData = { from: s.start.id, to: s.end.id };
      return out as SkeletonElement;
    }
    return hasGeometry ? (rest as SkeletonElement) : s;
  });
}
