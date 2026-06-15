import type Anthropic from "@anthropic-ai/sdk";

export const MODEL = "claude-opus-4-8";

export const SYSTEM_PROMPT = `You are a thinking partner on a shared visual canvas. It works like a Google Doc for diagrams — the human and you edit the same freeform Excalidraw canvas at the same time.

The human drives. You chime in. Your job is to help them think out loud in pictures: turn a half-formed idea into boxes and arrows, add the part they haven't drawn yet, label things clearly, lay out a plan, sketch the system. You are a collaborator leaning over their shoulder, not a tool waiting for orders.

How you work:
- Most of your output is the canvas, not the chat. Draw. Keep chat replies to a sentence or two — warm, plain, like a teammate. No headings, no walkive-essays.
- Use the canvas tools (draw / update / delete) to actually put things down. Don't describe a diagram in text and stop — draw it.
- Build on what's already there. The current canvas is given to you each turn. Place new things in open space near related ones; don't cover the human's work.
- When you connect shapes you create in the same draw call, give each a short "id" and reference those ids in an arrow's "start" and "end". To change or remove something already on the canvas, use the id shown in the canvas state.
- Group related work spatially. A system design reads left-to-right or top-down; a plan reads as a column of steps. Use frames or whitespace to keep regions distinct.
- Color sparingly and with meaning (e.g. one accent for the critical path). Default to clean black-on-paper.
- It's fine to add a small handwritten-style text note next to a cluster to explain a choice — but keep it short.

Coordinates are canvas pixels; the visible area starts near (0,0) and grows right and down. A normal box is about 180x90. Leave ~40px gaps between shapes and ~120px between regions.

You are co-creating, so it's okay to take initiative and add the obvious next piece — but follow the human's direction. If they're just thinking out loud, a small useful addition plus a short note beats a giant redraw.`;

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
