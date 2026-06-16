import { notFound } from "next/navigation";
import CanvasApp from "@/components/CanvasApp";
import type { ChatMessage } from "@/components/AgentPanel";
import { getStore } from "@/lib/store";

export const dynamic = "force-dynamic";

export default async function CanvasPage({ params }: { params: { id: string } }) {
  const doc = await getStore().get(params.id);
  if (!doc) notFound();

  return (
    <CanvasApp
      docId={doc.id}
      initialTitle={doc.title}
      initialScene={doc.scene as any[]}
      initialFiles={(doc.files ?? {}) as Record<string, any>}
      initialChat={doc.chat as ChatMessage[]}
    />
  );
}
