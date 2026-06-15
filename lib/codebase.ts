import { promises as fs } from "fs";
import path from "path";

// Codebase tools read the user's local filesystem, so they only run when the
// app runs locally (not on Vercel) and only inside the folder the user named.
export function codebaseAllowed(): boolean {
  return !process.env.VERCEL;
}

const IGNORE = new Set([
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
]);

const MAX_ENTRIES = 300;
const MAX_FILE_CHARS = 12_000;

// Resolve `rel` under `root`, refusing anything that escapes the root.
function resolveInRoot(root: string, rel: string): string {
  const base = path.resolve(root);
  const target = path.resolve(base, rel || ".");
  if (target !== base && !target.startsWith(base + path.sep)) {
    throw new Error("path is outside the codebase root");
  }
  return target;
}

export async function rootExists(root: string): Promise<boolean> {
  try {
    return (await fs.stat(path.resolve(root))).isDirectory();
  } catch {
    return false;
  }
}

export async function listDir(root: string, rel = "."): Promise<string> {
  const dir = resolveInRoot(root, rel);
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const lines: string[] = [];
  for (const e of entries) {
    if (e.name.startsWith(".") && e.name !== ".env.example") continue;
    if (e.isDirectory() && IGNORE.has(e.name)) continue;
    lines.push(e.isDirectory() ? `${e.name}/` : e.name);
    if (lines.length >= MAX_ENTRIES) {
      lines.push(`… (truncated at ${MAX_ENTRIES} entries)`);
      break;
    }
  }
  lines.sort();
  const shown = rel === "." ? "(root)" : rel;
  return lines.length ? `${shown}:\n${lines.join("\n")}` : `${shown}: (empty)`;
}

export async function readCodeFile(root: string, rel: string): Promise<string> {
  const file = resolveInRoot(root, rel);
  const stat = await fs.stat(file);
  if (!stat.isFile()) return `${rel} is not a file.`;
  if (stat.size > 400_000) return `${rel} is too large (${stat.size} bytes) — skipped.`;
  const buf = await fs.readFile(file);
  if (buf.includes(0)) return `${rel} looks binary — skipped.`;
  const text = buf.toString("utf8");
  return text.length > MAX_FILE_CHARS
    ? text.slice(0, MAX_FILE_CHARS) + `\n… (truncated, ${text.length} chars total)`
    : text;
}

// Server-side execution of a codebase tool call. Returns the content string fed
// back to the model as the tool result.
export async function runCodebaseTool(
  name: string,
  input: Record<string, unknown>,
  root: string,
): Promise<string> {
  try {
    if (name === "list_dir") return await listDir(root, String(input.path ?? "."));
    if (name === "read_file") return await readCodeFile(root, String(input.path ?? ""));
    return `Unknown tool ${name}`;
  } catch (err) {
    return `Error: ${err instanceof Error ? err.message : String(err)}`;
  }
}

export const CODEBASE_TOOL_NAMES = new Set(["list_dir", "read_file"]);
