import { describe, expect, it } from "vitest";
import { buildBriefMarkdown, slugify } from "@/lib/export";

describe("buildBriefMarkdown", () => {
  const md = buildBriefMarkdown("My Design", [
    { role: "user", text: "Sketch a URL shortener" },
    { role: "assistant", text: "Here's the architecture.", notes: ["Added a cache"] },
    { role: "user", text: "  " }, // empty -> skipped
  ]);

  it("includes the title, image reference, and conversation", () => {
    expect(md).toContain("# My Design — design brief");
    expect(md).toContain("![Canvas](./canvas.png)");
    expect(md).toContain("### You");
    expect(md).toContain("Sketch a URL shortener");
    expect(md).toContain("### Canvas partner");
    expect(md).toContain("Here's the architecture.");
  });

  it("renders agent notes as blockquotes and skips empty turns", () => {
    expect(md).toContain("> ✎ Added a cache");
    // the whitespace-only user turn produces no extra "### You" beyond the first
    expect(md.match(/### You/g)?.length).toBe(1);
  });

  it("ends with the coding-agent handoff line", () => {
    expect(md).toMatch(/Claude Code, Codex/);
  });
});

describe("slugify", () => {
  it("makes a filename-safe slug", () => {
    expect(slugify("My Cool Design!")).toBe("my-cool-design");
    expect(slugify("")).toBe("canvas");
    expect(slugify("  ---  ")).toBe("canvas");
  });
});
