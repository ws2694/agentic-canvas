import { describe, expect, it } from "vitest";
import { pushHistory } from "@/lib/store/history";

const scene = (n: number) => ({ scene: Array.from({ length: n }, () => ({})), title: "t" });
const T0 = 1_000_000;

describe("pushHistory", () => {
  it("never snapshots an empty scene", () => {
    expect(pushHistory([], scene(0), T0)).toEqual([]);
  });

  it("snapshots a non-empty scene with its element count", () => {
    const h = pushHistory([], scene(3), T0);
    expect(h).toHaveLength(1);
    expect(h[0].count).toBe(3);
  });

  it("replaces the latest snapshot within the throttle window", () => {
    let h = pushHistory([], scene(3), T0);
    h = pushHistory(h, scene(2), T0 + 10_000); // <30s later
    expect(h).toHaveLength(1);
    expect(h[0].count).toBe(2); // keeps the newest pre-write state
  });

  it("adds a new snapshot after the throttle window", () => {
    let h = pushHistory([], scene(3), T0);
    h = pushHistory(h, scene(2), T0 + 40_000); // >30s later
    expect(h).toHaveLength(2);
    expect(h[0].count).toBe(2); // newest first
    expect(h[1].count).toBe(3);
  });

  it("caps history at 10 entries", () => {
    let h: ReturnType<typeof pushHistory> = [];
    for (let i = 0; i < 15; i++) h = pushHistory(h, scene(i + 1), T0 + i * 40_000);
    expect(h).toHaveLength(10);
    // newest first: the last push had count 15
    expect(h[0].count).toBe(15);
  });
});
