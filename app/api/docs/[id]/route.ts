import { getStore } from "@/lib/store";
import type { DocPatch } from "@/lib/store";

export const runtime = "nodejs";

type Ctx = { params: { id: string } };

export async function GET(_req: Request, { params }: Ctx) {
  const doc = await getStore().get(params.id);
  if (!doc) return Response.json({ error: "not found" }, { status: 404 });
  return Response.json({ doc });
}

export async function PUT(req: Request, { params }: Ctx) {
  let patch: DocPatch;
  try {
    const body = await req.json();
    patch = {
      title: typeof body?.title === "string" ? body.title : undefined,
      scene: Array.isArray(body?.scene) ? body.scene : undefined,
      chat: Array.isArray(body?.chat) ? body.chat : undefined,
    };
  } catch {
    return Response.json({ error: "invalid body" }, { status: 400 });
  }
  try {
    await getStore().save(params.id, patch);
  } catch {
    return Response.json({ error: "not found" }, { status: 404 });
  }
  return Response.json({ ok: true });
}

export async function DELETE(_req: Request, { params }: Ctx) {
  await getStore().remove(params.id);
  return Response.json({ ok: true });
}
