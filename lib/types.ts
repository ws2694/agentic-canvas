// Shared types between the agent API route and the canvas client.

// A loose Excalidraw "skeleton" element the agent emits. We keep it permissive
// on purpose — convertToExcalidrawElements (run on the client) fills in the rest.
export type SkeletonElement = {
  type: "rectangle" | "ellipse" | "diamond" | "text" | "arrow" | "line" | "frame";
  id?: string;
  x: number;
  y: number;
  width?: number;
  height?: number;
  text?: string;
  strokeColor?: string;
  backgroundColor?: string;
  // For arrows / lines: bind to another element by id, or pin to a point.
  start?: { id?: string; x?: number; y?: number };
  end?: { id?: string; x?: number; y?: number };
  [key: string]: unknown;
};

export type ElementPatch = {
  id: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  text?: string;
  strokeColor?: string;
  backgroundColor?: string;
};

// Server -> client events streamed over SSE.
export type AgentEvent =
  | { type: "text"; text: string }
  | { type: "status"; status: "thinking" | "drawing" | "idle" }
  | { type: "draw"; elements: SkeletonElement[]; note?: string }
  | { type: "update"; patches: ElementPatch[] }
  | { type: "delete"; ids: string[] }
  | { type: "notice"; message: string }
  | { type: "done" }
  | { type: "error"; message: string };

// A compact view of one element, sent to the agent so it knows what's on the canvas.
export type SceneItem = {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  text?: string;
};

// Client -> server request body.
export type ChatTurn = { role: "user" | "assistant"; text: string };

export type ImageInput = { mediaType: string; data: string }; // base64, no data: prefix

export type AgentRequest = {
  message: string;
  history: ChatTurn[];
  scene: SceneItem[];
  image?: ImageInput; // a pasted picture to recreate
  repoRoot?: string; // a local folder to diagram (local only)
};
