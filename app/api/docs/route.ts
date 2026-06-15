import { getStore } from "@/lib/store";

export const runtime = "nodejs";

export async function GET() {
  const docs = await getStore().list();
  return Response.json({ docs });
}

export async function POST(req: Request) {
  let title: string | undefined;
  try {
    const body = await req.json();
    title = typeof body?.title === "string" ? body.title : undefined;
  } catch {
    // no body is fine — create an untitled canvas
  }
  const doc = await getStore().create(title);
  return Response.json({ doc }, { status: 201 });
}
