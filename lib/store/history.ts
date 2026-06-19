import type { DocVersion } from "./types";

const MAX_HISTORY = 10;
const THROTTLE_MS = 30_000; // within this window, replace the latest snapshot instead of adding

// Record the pre-write scene into history. Newest first. Empty scenes are never
// snapshotted (nothing worth recovering). Rapid autosaves collapse into one
// snapshot per ~30s window so history spans minutes, not seconds.
export function pushHistory(
  history: DocVersion[] | undefined,
  prev: { scene: unknown[]; title: string },
  nowMs: number,
): DocVersion[] {
  const h = history ?? [];
  if (!prev.scene || prev.scene.length === 0) return h;

  const entry: DocVersion = {
    id: String(nowMs),
    savedAt: new Date(nowMs).toISOString(),
    count: prev.scene.length,
    scene: prev.scene,
    title: prev.title,
  };

  const last = h[0];
  if (last && nowMs - new Date(last.savedAt).getTime() < THROTTLE_MS) {
    return [entry, ...h.slice(1)].slice(0, MAX_HISTORY);
  }
  return [entry, ...h].slice(0, MAX_HISTORY);
}
