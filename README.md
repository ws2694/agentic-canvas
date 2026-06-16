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

## Generate from a picture or a codebase

Two ways to seed a diagram beyond typing:

- **From a picture** — drop or paste an image: a whiteboard photo, a hand sketch,
  a screenshot of an existing diagram. The agent (Claude / gpt-4o vision) recreates
  it on the canvas, cleaned up with the visual language. Paste it **into the chat**
  to attach it to one message, or **onto the canvas** — the agent sees image
  elements on the canvas (the selected ones, or a lone pasted one) and can read,
  recreate, or build on them. Pasted images persist with the canvas.
- **From a codebase** — click the folder icon to open your OS folder picker (no
  path typing) and choose a repo. The browser reads the file tree + the most
  relevant files (configs, entry points, source — filtered for `node_modules`
  etc., size-capped) into a snapshot and the agent draws the architecture from
  the real code. Because the read happens in the browser, this works on the
  deploy too. Browsers without the File System Access API fall back to a typed
  path (read server-side, local only).

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

## Provider fallback

The agent runs behind a vendor-neutral provider interface ([lib/providers/](lib/providers/)),
so a turn can be served by any backend. The fallback chain is built from whatever
keys are configured:

```
Claude Opus 4.8  →  Claude Sonnet 4.6  →  Claude Haiku 4.5  →  OpenAI gpt-4o
```

If a backend is rate-limited (429), overloaded (529), down (5xx), or out of
credits/quota *before it streams any text*, the same turn retries on the next one
and stays there for the rest of the session. You'll see a short
"Claude Opus is busy — switched to GPT-4o" note in the chat.

- A provider is only in the chain if its key is set. With just `ANTHROPIC_API_KEY`
  you get the Claude tiers; add `OPENAI_API_KEY` to turn on cross-provider
  fallback. Either key alone works.
- Override the model lists with env vars (comma-separated ids):

  ```bash
  AGENT_MODELS=claude-opus-4-8,claude-sonnet-4-6,claude-haiku-4-5
  OPENAI_MODELS=gpt-4o
  ```

Adding another provider is one file: implement the `Provider` interface in
`lib/providers/` and add it to the chain in `lib/providers/index.ts`.

## Persistence

Canvases are saved automatically. Each lives at `/c/[id]`; the home page lists
them. The Excalidraw scene + chat history autosave (debounced) and reload on
open.

Storage is one env var:

- **Local (default):** JSON files under `.data/docs/`. Zero setup — just `npm run dev`.
- **Production (Vercel):** set `DATABASE_URL` to a Postgres connection string
  (e.g. Neon / Vercel Postgres). The `documents` table is created on first use.

Vercel's filesystem is ephemeral, so a deploy **must** set `DATABASE_URL` — the
JSON-file store won't persist there.

## Develop

```bash
npm run dev         # http://localhost:3000
npm run typecheck   # tsc --noEmit
npm test            # vitest — geometry, scene summary, provider conversion, arrow re-routing
npm run build
```

CI (`.github/workflows/ci.yml`) runs typecheck + test + build on every PR.

## Layout

```
app/
  page.tsx             # home: list of canvases
  c/[id]/page.tsx      # the canvas editor (loads the saved doc)
  api/agent/route.ts   # streaming agent loop (SSE), provider-agnostic
  api/docs/...         # CRUD for saved canvases
components/
  CanvasApp.tsx        # Excalidraw + applies streamed edits + autosave
  AgentPanel.tsx       # the chat side panel
  HomeClient.tsx       # the canvas list
lib/
  agent.ts             # system prompt, tool schemas
  geometry.ts          # pure: arrow endpoints / re-routing math (unit-tested)
  elements.ts          # skeleton -> Excalidraw conversion, patch/delete, scene summary
  scene.ts             # pure: agent-facing scene summary (unit-tested)
  providers/           # vendor-neutral LLM provider interface + Claude/OpenAI adapters
  store/               # Store interface + file (local) and Postgres adapters
  types.ts             # shared types
tests/                 # vitest unit tests
```

## Notes

- Within a single `draw` call the agent connects shapes by giving them ids and
  referencing those ids in an arrow's `start`/`end`. Across turns it edits
  existing shapes by the id shown in the canvas summary. Arrows record the shapes
  they link and re-route automatically when a box moves.
- This is a single-user app. Real-time multiplayer (multiple humans + agents on
  one canvas) would layer a sync backend under the same model.
