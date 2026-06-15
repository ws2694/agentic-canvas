import type { ToolDef } from "@/lib/providers/types";

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

Coordinates are canvas pixels.

VISUAL LANGUAGE — follow these so diagrams come out clean and consistent.

Grid: snap every x, y, width, height to a multiple of 20. Boxes in the same row share a y; boxes in the same column share an x. Alignment is the single biggest thing that makes a diagram look professional.

Shared palette — use the SAME color for the same meaning across every diagram (≤4 fills + gray, and pair color with shape so it survives black-and-white):
- Blue stroke #1971c2 / fill #a5d8ff = your service / the primary path.
- Green #2f9e44 / #b2f2bb = datastore, or "done".
- Orange #e8590c / #ffd8a8 = external / third-party system.
- Amber #f08c00 / #ffec99 = decision, or a milestone.
- Red #e03131 / #ffc9c9 = error / risk / blocked.
- Gray #868e96 / #e9ecef = neutral, planned, or a boundary.
Default plain shapes to a black stroke and transparent fill; use color only when it carries one of those meanings.

Arrows: solid = synchronous call / direct flow; dashed (strokeStyle "dashed") = asynchronous (event/queue) or a dependency. Put a short label (the arrow's "text") on cross-component and decision arrows; leave plain sequential steps unlabeled.

Pick the layout for the diagram type:
- System / architecture (boxes = services, arrows = calls): top-to-bottom (clients at top, datastores at bottom); left-to-right if it's a linear pipeline. Box 220x100, 80px gap within a layer, 120px between layers. Blue = yours, orange = external, green = datastore. Group a layer or trust boundary with a frame.
- Sequence (who calls whom over time): actor headers 150x60 in a row across the top, ~200px apart; time flows down; messages are horizontal labeled arrows ~60px apart; dashed for returns.
- Flowchart: top-to-bottom. Ellipse 160x60 = start/end; rounded rectangle 200x80 = step; diamond 180x120 = decision. 80px vertical gap; branches offset 220px to the side; label every decision branch (Yes/No); keep the happy path on a straight spine. Green = start/end, blue = step, amber = decision, red = failure.
- Project plan / roadmap: left-to-right = time. Either columns (260 wide, 240x80 cards) or swimlanes (120 tall with duration bars). Diamond = milestone. Green = done, blue = in progress, gray = planned, red = at risk; dashed arrow = dependency.

Always: one flow direction per diagram, no overlaps (≥80px between unrelated boxes), labels ≤2 lines, and a short title text above the diagram.

Take initiative on the obvious next piece, but follow the human's direction. A small, tidy addition beats a big messy redraw.`;

export const TOOLS: ToolDef[] = [
  {
    name: "draw",
    description:
      "Add new elements to the shared canvas. Pass a coherent batch (e.g. several boxes plus the arrows between them). To connect two shapes you create here, give each an `id` and reference those ids in an arrow's `start`/`end`.",
    parameters: {
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
              strokeStyle: {
                type: "string",
                enum: ["solid", "dashed", "dotted"],
                description: "Line style. Use 'dashed' for async / dependency arrows.",
              },
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
    parameters: {
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
    parameters: {
      type: "object",
      properties: {
        ids: { type: "array", items: { type: "string" } },
      },
      required: ["ids"],
    },
  },
];
