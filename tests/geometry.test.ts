import { describe, expect, it } from "vitest";
import { center, edgePoint, withArrowGeometry } from "@/lib/geometry";
import type { SkeletonElement } from "@/lib/types";

describe("center", () => {
  it("returns the middle of a box", () => {
    expect(center({ x: 100, y: 200, width: 200, height: 100 })).toEqual({ x: 200, y: 250 });
  });
});

describe("edgePoint", () => {
  const box = { x: 0, y: 0, width: 200, height: 100 }; // center (100,50)

  it("lands on the right edge (plus gap) when pointing right", () => {
    const p = edgePoint(box, { x: 1000, y: 50 }, 6);
    expect(p.y).toBeCloseTo(50);
    expect(p.x).toBeCloseTo(206); // right edge 200 + 6 gap
  });

  it("lands on the top edge when pointing up", () => {
    const p = edgePoint(box, { x: 100, y: -1000 }, 6);
    expect(p.x).toBeCloseTo(100);
    expect(p.y).toBeCloseTo(-6); // top edge 0 - 6 gap
  });
});

describe("withArrowGeometry", () => {
  const a: SkeletonElement = { type: "rectangle", id: "a", x: 0, y: 0, width: 100, height: 100 };
  const b: SkeletonElement = { type: "rectangle", id: "b", x: 300, y: 0, width: 100, height: 100 };

  it("gives a bound arrow real edge-to-edge geometry and records the link", () => {
    const shapes = new Map([
      ["a", a],
      ["b", b],
    ]);
    const arrow: SkeletonElement = { type: "arrow", x: 0, y: 0, start: { id: "a" }, end: { id: "b" } };
    const [out] = withArrowGeometry([arrow], shapes) as any[];

    // a's right edge (~106) to b's left edge (~294), same y (center 50)
    expect(out.x).toBeCloseTo(106);
    expect(out.y).toBeCloseTo(50);
    expect(out.width).toBeCloseTo(188);
    expect(out.height).toBeCloseTo(0);
    expect(out.customData).toEqual({ from: "a", to: "b" });
    expect(out.start).toBeUndefined();
    expect(out.end).toBeUndefined();
  });

  it("resolves against existing canvas shapes (not just the batch)", () => {
    const shapes = new Map([["a", a]]); // only 'a' is on the canvas; 'b' is too
    shapes.set("b", b);
    const arrow: SkeletonElement = { type: "arrow", x: 0, y: 0, start: { id: "a" }, end: { id: "b" } };
    const [out] = withArrowGeometry([arrow], shapes) as any[];
    expect(out.customData).toEqual({ from: "a", to: "b" });
    expect(Number.isFinite(out.width)).toBe(true);
  });

  it("leaves non-arrow elements untouched", () => {
    const [out] = withArrowGeometry([a], new Map());
    expect(out).toBe(a);
  });

  it("supports fixed-point endpoints without an id", () => {
    const arrow: SkeletonElement = {
      type: "arrow",
      x: 0,
      y: 0,
      start: { x: 10, y: 10 },
      end: { x: 50, y: 90 },
    };
    const [out] = withArrowGeometry([arrow], new Map()) as any[];
    expect(out.x).toBe(10);
    expect(out.y).toBe(10);
    expect(out.width).toBe(40);
    expect(out.height).toBe(80);
    expect(out.customData).toBeUndefined();
  });
});
