import { describe, expect, it } from "vitest";
import { applyDelete, applyPatches, rerouteArrows, summarizeScene } from "@/lib/elements";
import { withArrowGeometry } from "@/lib/geometry";
import type { SkeletonElement } from "@/lib/types";

describe("applyPatches", () => {
  const els = [
    { id: "a", type: "rectangle", x: 0, y: 0, width: 100, height: 50, version: 1 },
    { id: "b", type: "rectangle", x: 200, y: 0, width: 100, height: 50, version: 1 },
  ];

  it("moves and recolors by id, bumps version, leaves others alone", () => {
    const out = applyPatches(els, [{ id: "a", x: 40, y: 40, backgroundColor: "#fff" }]);
    expect(out[0]).toMatchObject({ x: 40, y: 40, backgroundColor: "#fff", version: 2 });
    expect(out[1]).toBe(els[1]);
  });

  it("only relabels text elements", () => {
    const out = applyPatches([{ id: "t", type: "text", x: 0, y: 0 }], [{ id: "t", text: "hi" }]);
    expect(out[0]).toMatchObject({ text: "hi", originalText: "hi" });
  });
});

describe("applyDelete", () => {
  it("removes by id and the text bound to a deleted container", () => {
    const els = [
      { id: "box", type: "rectangle", boundElements: [{ type: "text", id: "t" }] },
      { id: "t", type: "text", containerId: "box" },
      { id: "keep", type: "rectangle" },
    ];
    const out = applyDelete(els, ["box"]);
    expect(out.map((e) => e.id)).toEqual(["keep"]);
  });
});

describe("summarizeScene", () => {
  it("folds bound text into its container and keeps free text", () => {
    const els = [
      { id: "box", type: "rectangle", x: 0, y: 0, width: 100, height: 50, boundElements: [{ type: "text", id: "t" }] },
      { id: "t", type: "text", containerId: "box", text: "Hello" },
      { id: "note", type: "text", x: 200, y: 0, width: 80, height: 20, text: "free note" },
    ];
    const out = summarizeScene(els);
    expect(out.map((e) => e.id).sort()).toEqual(["box", "note"]);
    expect(out.find((e) => e.id === "box")?.text).toBe("Hello");
    expect(out.find((e) => e.id === "note")?.text).toBe("free note");
  });

  it("drops deleted elements", () => {
    const out = summarizeScene([{ id: "x", type: "rectangle", isDeleted: true }]);
    expect(out).toEqual([]);
  });
});

describe("rerouteArrows", () => {
  function fakeApi(elements: any[]) {
    const state = { elements };
    return {
      getSceneElements: () => state.elements,
      updateScene: ({ elements }: { elements?: any[] }) => {
        if (elements) state.elements = elements;
      },
      get elements() {
        return state.elements;
      },
    };
  }

  function scene() {
    const a = { id: "a", type: "rectangle", x: 0, y: 0, width: 100, height: 100 };
    const b = { id: "b", type: "rectangle", x: 300, y: 0, width: 100, height: 100 };
    const shapes = new Map<string, any>([
      ["a", a],
      ["b", b],
    ]);
    const arrow: SkeletonElement = { type: "arrow", x: 0, y: 0, start: { id: "a" }, end: { id: "b" } };
    const [built] = withArrowGeometry([arrow], shapes) as any[];
    return [a, b, { ...built, id: "arr" }];
  }

  it("is a no-op when nothing moved", () => {
    const api = fakeApi(scene());
    expect(rerouteArrows(api)).toBe(false);
  });

  it("re-routes the arrow when a connected box moves, and is idempotent after", () => {
    const els = scene();
    const api = fakeApi(els);
    els[1].x = 600; // move box b to the right

    expect(rerouteArrows(api)).toBe(true);
    const arr = api.elements.find((e: any) => e.id === "arr");
    const lastX = arr.x + arr.points[arr.points.length - 1][0];
    expect(lastX).toBeCloseTo(594); // b's new left edge (600 - 6 gap)

    // Calling again with nothing moved makes no further change.
    expect(rerouteArrows(api)).toBe(false);
  });
});
