import type Anthropic from "@anthropic-ai/sdk";

export const MODEL = "claude-opus-4-8";

export const SYSTEM_PROMPT = `You are a thinking partner on a shared visual canvas — like a Google Doc for diagrams. A human is designing a system or plan; you edit the same Excalidraw canvas with them. They drive, you chime in: turn a half-formed idea into clean boxes and arrows, fill in the missing piece, label things, lay out a plan.

How you work:
- Most of your output is the canvas, not the chat. Draw. Keep chat to a sentence or two — warm and plain, like a teammate. No headings or essays.
- Use draw / update / delete to actually change the canvas. Don't describe a diagram and stop — draw it.

Keep the canvas clean — this matters most. A messy diagram is worse than a small one, and the canvas grows over many turns, so every addition has to fit what's already there:
- Every box carries its own label. Put the words INSIDE the box using that box's "text" field. NEVER name a box with a separate floating text element, and never leave a box empty.
- One idea = one labeled box. Don't drop placeholder boxes you mean to fill later — label them now or don't draw them.
- Respect the layout you're given. The canvas state lists every element with its position and size, and where the open space is. Put new work in that open space, align it into the existing rows and columns, leave ~40px gaps, and NEVER place a shape on top of an existing one.
- Tidy before you add. If things are crowding or overlapping, reorganize with update (move/relabel) and delete — don't pile a new cluster on top. Moving three boxes into a clean column beats adding a fourth that overlaps.
- Don't wrap loose text in a big rectangle to "group" it. Group with alignment and whitespace; never draw a giant empty box around floating labels.
- Arrows connect adjacent, related boxes and stay short. Avoid long diagonal arrows across the whole diagram — if two related boxes are far apart, move one closer first, then connect them.
- Color sparingly and with meaning (one accent for the critical path). Default to black on the paper background.

Connecting shapes:
- Within one draw call, give shapes short ids and reference them in an arrow's "start" and "end".
- To wire boxes already on the canvas, reference the ids shown in the canvas state.

Coordinates are canvas pixels. A normal box is about 180x90. A system diagram reads top-down or left-to-right; a plan reads as a column of steps.

Take initiative on the obvious next piece, but follow the human's direction. A small, tidy addition beats a big messy redraw.`;

export const TOOLS: Anthropic.Tool[] = [
  {
    name: "draw",
    description:
      "Add new elements to the shared canvas. Pass a coherent batch (e.g. several boxes plus the arrows between them). To connect two shapes you create here, give each an `id` and reference those ids in an arrow's `start`/`end`.",
    input_schema: {
      type: "object",
      properties: {
        note: {
          type: "string",
          description: "Optional one-line reason for this addition, shown to the human.",
        },
        elements: {
          type: "array",
          description: "The elements to add.",
          items: {
            type: "object",
            properties: {
              type: {
                type: "string",
                enum: ["rectangle", "ellipse", "diamond", "text", "arrow", "line", "frame"],
              },
              id: { type: "string", description: "Short stable id, e.g. 'db' or 'step1'." },
              x: { type: "number" },
              y: { type: "number" },
              width: { type: "number" },
              height: { type: "number" },
              text: {
                type: "string",
                description: "Label inside a shape, or the content of a text element.",
              },
              strokeColor: { type: "string", description: "Hex color for the outline/text." },
              backgroundColor: { type: "string", description: "Hex fill color, or 'transparent'." },
              start: {
                type: "object",
                description: "Arrow/line start: { id } to bind to a shape, or { x, y } to pin.",
                properties: {
                  id: { type: "string" },
                  x: { type: "number" },
                  y: { type: "number" },
                },
              },
              end: {
                type: "object",
                description: "Arrow/line end: { id } to bind to a shape, or { x, y } to pin.",
                properties: {
                  id: { type: "string" },
                  x: { type: "number" },
                  y: { type: "number" },
                },
              },
            },
            required: ["type", "x", "y"],
          },
        },
      },
      required: ["elements"],
    },
  },
  {
    name: "update",
    description:
      "Move, recolor, resize, or relabel elements already on the canvas. Identify each by the id shown in the canvas state.",
    input_schema: {
      type: "object",
      properties: {
        patches: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              x: { type: "number" },
              y: { type: "number" },
              width: { type: "number" },
              height: { type: "number" },
              text: { type: "string" },
              strokeColor: { type: "string" },
              backgroundColor: { type: "string" },
            },
            required: ["id"],
          },
        },
      },
      required: ["patches"],
    },
  },
  {
    name: "delete",
    description: "Remove elements from the canvas by id.",
    input_schema: {
      type: "object",
      properties: {
        ids: { type: "array", items: { type: "string" } },
      },
      required: ["ids"],
    },
  },
];
