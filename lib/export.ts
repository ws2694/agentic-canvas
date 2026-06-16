// Build a handoff brief from a canvas conversation: the human's intent plus the
// agent's reasoning, formatted for a coding agent (Claude Code / Codex) to read
// alongside the exported diagram image.

export type BriefMessage = { role: "user" | "assistant"; text: string; notes?: string[] };

export function buildBriefMarkdown(title: string, messages: BriefMessage[]): string {
  const name = title.trim() || "Untitled canvas";
  const lines: string[] = [
    `# ${name} — design brief`,
    "",
    "A system/plan designed on a freeform canvas. The diagram is `canvas.png`. The conversation below is the intent and the design reasoning behind it. Use both together to implement the design.",
    "",
    "![Canvas](./canvas.png)",
    "",
    "## Conversation",
    "",
  ];

  for (const m of messages) {
    const text = m.text?.trim();
    if (m.role === "user") {
      if (text) lines.push("### You", "", text, "");
    } else {
      if (text) lines.push("### Canvas partner", "", text, "");
      for (const note of m.notes ?? []) {
        if (note.trim()) lines.push(`> ✎ ${note.trim()}`, "");
      }
    }
  }

  lines.push(
    "---",
    "",
    "Hand `canvas.png` and this brief to your coding agent (Claude Code, Codex) and ask it to implement the design.",
    "",
  );
  return lines.join("\n");
}

export function slugify(s: string): string {
  const out = (s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50);
  return out || "canvas";
}
