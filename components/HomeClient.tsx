"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

type DocSummary = { id: string; title: string; createdAt: string; updatedAt: string };

function ago(iso: string): string {
  const s = Math.max(1, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return d < 30 ? `${d}d ago` : new Date(iso).toLocaleDateString();
}

export function HomeClient() {
  const router = useRouter();
  const [docs, setDocs] = useState<DocSummary[] | null>(null);
  const [creating, setCreating] = useState(false);

  const load = () =>
    fetch("/api/docs")
      .then((r) => r.json())
      .then((d) => setDocs(d.docs ?? []))
      .catch(() => setDocs([]));

  useEffect(() => {
    load();
  }, []);

  const create = async () => {
    setCreating(true);
    try {
      const res = await fetch("/api/docs", { method: "POST" });
      const { doc } = await res.json();
      router.push(`/c/${doc.id}`);
    } finally {
      setCreating(false);
    }
  };

  const remove = async (id: string) => {
    setDocs((prev) => prev?.filter((d) => d.id !== id) ?? null);
    await fetch(`/api/docs/${id}`, { method: "DELETE" });
  };

  return (
    <div className="min-h-dvh bg-paper">
      <div className="mx-auto max-w-3xl px-6 py-16">
        <div className="mb-10 flex items-end justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-ink">Agentic Canvas</h1>
            <p className="mt-1 text-sm text-neutral-500">
              Freeform canvases you and an agent design together.
            </p>
          </div>
          <button
            onClick={create}
            disabled={creating}
            className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-white transition hover:bg-amber-600 disabled:opacity-50"
          >
            {creating ? "Creating…" : "New canvas"}
          </button>
        </div>

        {docs === null ? (
          <p className="text-sm text-neutral-400">Loading…</p>
        ) : docs.length === 0 ? (
          <div className="rounded-xl border border-dashed border-line bg-white/50 py-16 text-center">
            <p className="text-sm text-neutral-500">No canvases yet.</p>
            <button onClick={create} className="mt-3 text-sm font-medium text-amber-600 hover:text-amber-700">
              Start your first one →
            </button>
          </div>
        ) : (
          <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-white">
            {docs.map((d) => (
              <li key={d.id} className="group flex items-center gap-3 px-4 py-3 hover:bg-paper/60">
                <Link href={`/c/${d.id}`} className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-ink">{d.title || "Untitled canvas"}</div>
                  <div className="text-xs text-neutral-400">Edited {ago(d.updatedAt)}</div>
                </Link>
                <button
                  onClick={() => remove(d.id)}
                  className="rounded-md px-2 py-1 text-xs text-neutral-400 opacity-0 transition hover:bg-red-50 hover:text-red-600 group-hover:opacity-100"
                >
                  Delete
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
