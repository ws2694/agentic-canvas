// A point-in-time snapshot of the scene, kept so a bad write is recoverable.
// Scene + title only (no files) to stay small — restore keeps the current files.
export type DocVersion = {
  id: string; // timestamp ms, as a string
  savedAt: string;
  count: number; // element count, for the list UI
  scene: unknown[];
  title: string;
};

export type DocVersionMeta = { id: string; savedAt: string; count: number };

// A saved canvas: the Excalidraw scene plus the chat history that produced it.
export type CanvasDoc = {
  id: string;
  title: string;
  scene: unknown[]; // Excalidraw elements
  files: Record<string, unknown>; // Excalidraw binary files (pasted images), keyed by fileId
  chat: unknown[]; // chat messages
  history: DocVersion[]; // recent scene snapshots (newest first)
  createdAt: string;
  updatedAt: string;
};

export type DocSummary = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
};

export type DocPatch = {
  title?: string;
  scene?: unknown[];
  files?: Record<string, unknown>;
  chat?: unknown[];
};

export interface Store {
  create(title?: string): Promise<CanvasDoc>;
  get(id: string): Promise<CanvasDoc | null>;
  list(): Promise<DocSummary[]>;
  save(id: string, patch: DocPatch): Promise<void>;
  remove(id: string): Promise<void>;
  listVersions(id: string): Promise<DocVersionMeta[]>;
  restoreVersion(id: string, versionId: string): Promise<CanvasDoc | null>;
}

// Short, URL-friendly id (no deps).
export function newId(): string {
  const alphabet = "23456789abcdefghijkmnpqrstuvwxyz";
  let s = "";
  for (let i = 0; i < 12; i++) s += alphabet[Math.floor(Math.random() * alphabet.length)];
  return s;
}
