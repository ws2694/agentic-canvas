import type { SceneItem } from "@/lib/types";

const LABELABLE = new Set(["rectangle", "ellipse", "diamond"]);

// Compact, agent-facing description of the canvas: every element with position
// and size, the occupied bounds, where the open space is, and which boxes are
// unlabeled (so the agent fills or removes them).
export function sceneToText(scene: SceneItem[]): string {
  if (!scene.length) return "The canvas is empty. Start near (200, 140).";

  const r = Math.round;
  const minX = Math.min(...scene.map((e) => e.x));
  const minY = Math.min(...scene.map((e) => e.y));
  const maxX = Math.max(...scene.map((e) => e.x + e.width));
  const maxY = Math.max(...scene.map((e) => e.y + e.height));

  const lines = scene.map((e) => {
    const text = e.text?.replace(/\s+/g, " ").trim();
    const empty = LABELABLE.has(e.type) && !text;
    const label = text
      ? ` "${text.slice(0, 40)}"`
      : empty
        ? " (EMPTY — label it or delete it)"
        : "";
    return `- ${e.id} (${e.type}) at (${r(e.x)},${r(e.y)}) ${r(e.width)}x${r(e.height)}${label}`;
  });

  return [
    `Current canvas — ${scene.length} elements, occupying x ${r(minX)}..${r(maxX)}, y ${r(minY)}..${r(maxY)}:`,
    lines.join("\n"),
    `Open space is below y=${r(maxY)} or right of x=${r(maxX)}. Put new work there, align it with the existing rows/columns, keep ~40px gaps, and don't overlap anything above. Fill or remove any boxes marked EMPTY.`,
  ].join("\n");
}
