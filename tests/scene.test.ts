import { describe, expect, it } from "vitest";
import { sceneToText } from "@/lib/scene";
import type { SceneItem } from "@/lib/types";

describe("sceneToText", () => {
  it("describes an empty canvas with a starting point", () => {
    expect(sceneToText([])).toMatch(/empty/i);
    expect(sceneToText([])).toMatch(/200, 140/);
  });

  it("lists elements with id, type, position and label", () => {
    const scene: SceneItem[] = [
      { id: "a", type: "rectangle", x: 40, y: 40, width: 200, height: 100, text: "Client" },
    ];
    const out = sceneToText(scene);
    expect(out).toContain("a (rectangle) at (40,40) 200x100");
    expect(out).toContain('"Client"');
  });

  it("flags labelable boxes with no text as EMPTY", () => {
    const scene: SceneItem[] = [
      { id: "x", type: "rectangle", x: 0, y: 0, width: 100, height: 100 },
    ];
    expect(sceneToText(scene)).toContain("EMPTY");
  });

  it("does not flag arrows/text as EMPTY", () => {
    const scene: SceneItem[] = [
      { id: "ar", type: "arrow", x: 0, y: 0, width: 100, height: 0 },
    ];
    // The standing guidance always mentions "EMPTY"; assert the arrow's own
    // line isn't flagged with the "(EMPTY —" marker.
    expect(sceneToText(scene)).not.toContain("(EMPTY");
  });

  it("reports occupied bounds and where the open space is", () => {
    const scene: SceneItem[] = [
      { id: "a", type: "rectangle", x: 40, y: 40, width: 200, height: 100, text: "A" },
      { id: "b", type: "rectangle", x: 40, y: 260, width: 200, height: 100, text: "B" },
    ];
    const out = sceneToText(scene);
    expect(out).toContain("x 40..240, y 40..360");
    expect(out).toMatch(/below y=360 or right of x=240/);
  });
});
