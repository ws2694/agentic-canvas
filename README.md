# Agentic Canvas

A freeform canvas for co-creating system designs and plans. It feels like a
Google Doc for diagrams: you draw, and an agent edits the same canvas alongside
you — adding boxes and arrows, labeling things, laying out a plan, filling in
the part you haven't figured out yet.

Built on the real [Excalidraw](https://excalidraw.com) canvas, with
[Claude](https://claude.com) (Opus 4.8) as the co-editor.

## How it works

- **You drive.** Draw anything you want on the canvas — it's the full Excalidraw
  tool, freeform.
- **The agent chimes in.** Message it in the side panel. It reads the current
  canvas, then draws its response directly onto it — shapes appear one at a time,
  like a collaborator sketching next to you.
- **Shared state is the canvas.** Each turn the agent gets a compact view of
  what's on the canvas, so it builds on your work instead of starting over.

Under the hood the agent has three tools — `draw`, `update`, `delete` — that emit
Excalidraw elements. The API route streams the agent's text and tool calls over
SSE; the client applies each edit to the live scene.

## Run it

```bash
cp .env.example .env        # then add your ANTHROPIC_API_KEY
npm install
npm run dev
```

Open http://localhost:3000.

You need an Anthropic API key from https://console.anthropic.com.

## Stack

- Next.js 14 (App Router) · React 18 · TypeScript · Tailwind
- `@excalidraw/excalidraw` for the canvas
- `@anthropic-ai/sdk` — `claude-opus-4-8`, adaptive thinking, tool use, streamed over SSE

## Model fallback

If the primary model is rate-limited (429) or overloaded (529) before it starts
streaming, the same turn retries on the next tier and stays there for the rest of
the session — so a busy Opus doesn't stall the canvas:

```
Opus 4.8  →  Sonnet 4.6  →  Haiku 4.5
```

You'll see a short "Opus is busy — switched to Sonnet" note in the chat when it
happens. Override the chain with an env var (comma-separated model ids):

```bash
AGENT_MODELS=claude-opus-4-8,claude-sonnet-4-6,claude-haiku-4-5
```

This covers per-model limits and overload. It does **not** cover your whole
Anthropic account running out of credits — for that you'd add a second provider.

## Layout

```
app/
  api/agent/route.ts   # streaming agent loop (SSE): text + draw/update/delete tool calls
  page.tsx             # mounts the canvas app
components/
  CanvasApp.tsx        # Excalidraw + applies streamed edits to the live scene
  AgentPanel.tsx       # the chat side panel
lib/
  agent.ts             # model, system prompt, tool schemas
  elements.ts          # skeleton -> Excalidraw conversion, patch/delete, scene summary
  types.ts             # shared types
```

## Notes

- Within a single `draw` call the agent connects shapes by giving them ids and
  referencing those ids in an arrow's `start`/`end`. Across turns it edits
  existing shapes by the id shown in the canvas summary.
- This is a single-user MVP. Real-time multiplayer (multiple humans + agents on
  one canvas) would layer a sync backend under the same model.
