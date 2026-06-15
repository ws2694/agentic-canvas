import { createFileStore } from "./file";
import { createPostgresStore } from "./postgres";
import type { Store } from "./types";

export type { CanvasDoc, DocSummary, DocPatch, Store } from "./types";

// Postgres when DATABASE_URL is set (Vercel/Neon), JSON files otherwise (local
// dev, zero setup). One env var swaps the backend.
let store: Store | null = null;

export function getStore(): Store {
  if (!store) {
    store = process.env.DATABASE_URL ? createPostgresStore() : createFileStore();
  }
  return store;
}
