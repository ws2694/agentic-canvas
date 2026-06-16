// Client-side: read a folder the user picks (File System Access API) into a
// compact snapshot — the file tree plus the contents of the most relevant files.
// Runs entirely in the browser, so it works on the deploy too and never touches
// a server filesystem.

import type { CodebaseSnapshot } from "@/lib/types";

const IGNORE_DIRS = new Set([
  "node_modules",
  ".git",
  ".next",
  ".vercel",
  ".turbo",
  "dist",
  "build",
  "out",
  "coverage",
  ".data",
  "vendor",
  ".cache",
  "__pycache__",
  ".venv",
  "target",
]);

const TEXT_EXT =
  /\.(ts|tsx|js|jsx|mjs|cjs|json|md|mdx|css|scss|html|py|go|rs|java|rb|php|c|cc|cpp|h|hpp|cs|swift|kt|svelte|vue|astro|yaml|yml|toml|sql|sh|prisma|graphql|gradle)$/i;
const SKIP_FILE = /(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|\.min\.|\.map$|\.lock$)/i;

const MAX_TREE = 1500;
const MAX_FILES = 40;
const MAX_FILE_CHARS = 6000;
const MAX_TOTAL_CHARS = 80_000;

export function canPickDirectory(): boolean {
  return typeof window !== "undefined" && "showDirectoryPicker" in window;
}

export async function pickCodebaseSnapshot(): Promise<CodebaseSnapshot | null> {
  const picker = (window as any).showDirectoryPicker;
  if (!picker) return null;
  let dir: any;
  try {
    dir = await picker({ mode: "read" });
  } catch {
    return null; // user cancelled
  }
  return buildSnapshot(dir);
}

// Rank files so the most architecture-revealing ones get read first.
function score(path: string): number {
  const name = path.split("/").pop() ?? path;
  let s = path.split("/").length; // shallower first
  if (/^(package\.json|tsconfig|go\.mod|cargo\.toml|requirements\.txt|pyproject\.toml|pom\.xml|composer\.json|gemfile|dockerfile)/i.test(name))
    s -= 20;
  if (/\.config\.|^next\.config|^vite\.config|^webpack|^tailwind\.config/i.test(name)) s -= 12;
  if (/^readme/i.test(name)) s -= 10;
  if (/(index|main|app|server|route|router|schema|api)\.[a-z]+$/i.test(name)) s -= 4;
  return s;
}

async function buildSnapshot(dir: any): Promise<CodebaseSnapshot> {
  const tree: string[] = [];
  const candidates: { path: string; handle: any }[] = [];

  async function walk(handle: any, prefix: string, depth: number): Promise<void> {
    if (depth > 8 || tree.length > MAX_TREE) return;
    for await (const [name, child] of handle.entries()) {
      if (name.startsWith(".") && name !== ".env.example") continue;
      const rel = prefix ? `${prefix}/${name}` : name;
      if (child.kind === "directory") {
        if (IGNORE_DIRS.has(name)) continue;
        tree.push(`${rel}/`);
        await walk(child, rel, depth + 1);
      } else {
        tree.push(rel);
        if (TEXT_EXT.test(name) && !SKIP_FILE.test(name)) candidates.push({ path: rel, handle: child });
      }
      if (tree.length > MAX_TREE) return;
    }
  }
  await walk(dir, "", 0);

  candidates.sort((a, b) => score(a.path) - score(b.path));

  const files: { path: string; content: string }[] = [];
  let total = 0;
  for (const c of candidates) {
    if (files.length >= MAX_FILES || total >= MAX_TOTAL_CHARS) break;
    try {
      const file = await c.handle.getFile();
      if (file.size > 300_000) continue;
      let text: string = await file.text();
      if (text.indexOf(String.fromCharCode(0)) !== -1) continue; // looks binary
      if (text.length > MAX_FILE_CHARS) text = text.slice(0, MAX_FILE_CHARS) + "\n…(truncated)";
      files.push({ path: c.path, content: text });
      total += text.length;
    } catch {
      /* skip unreadable file */
    }
  }

  return { name: dir.name || "codebase", tree: tree.slice(0, MAX_TREE), files };
}
