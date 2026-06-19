import { getStore } from "@/lib/store";

export const runtime = "nodejs";

type Ctx = { params: { id: string } };

// List the recent scene snapshots for a doc.
export async function GET(_req: Request, { params }: Ctx) {
  const versions = await getStore().listVersions(params.id);
  return Response.json({ versions });
}

// Restore a snapshot by id.
export async function POST(req: Request, { params }: Ctx) {
  let versionId: string;
  try {
    const body = await req.json();
    versionId = String(body?.versionId ?? "");
  } catch {
    return Response.json({ error: "invalid body" }, { status: 400 });
  }
  const doc = await getStore().restoreVersion(params.id, versionId);
  if (!doc) return Response.json({ error: "not found" }, { status: 404 });
  return Response.json({ doc });
}
