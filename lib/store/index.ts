import { createFileStore } from "./file";
import { createPostgresStore } from "./postgres";
import type { Store } from "./types";

export type { CanvasDoc, DocSummary, DocPatch, Store } from "./types";

// Postgres when a connection string is set (Vercel/Neon), JSON files otherwise
// (local dev, zero setup). DATABASE_URL is the manual name; POSTGRES_URL is what
// Vercel's Neon integration injects — accept either.
export function dbUrl(): string | undefined {
  return process.env.DATABASE_URL || process.env.POSTGRES_URL;
}

let store: Store | null = null;

export function getStore(): Store {
  if (!store) {
    store = dbUrl() ? createPostgresStore() : createFileStore();
  }
  return store;
}
