import { NextResponse } from "next/server";

import { apiError, withStaff } from "@/lib/api/handler";
import { getWhatsAppAiConfig } from "@/lib/crm/whatsapp-ai-config";
import {
  isWhatsAppWorkspaceAvailable,
  listChats,
  queueCounts,
  type ChatQueue,
} from "@/lib/crm/whatsapp-agent/workspace";

export const dynamic = "force-dynamic";

const QUEUES = new Set<ChatQueue>(["attention", "seguimiento", "mine", "ai", "all"]);

/**
 * Chats de WhatsApp por cola («Te toca», «Todos» —filtrable por modo: `mine`,
 * `ai`— y «Seguimiento»). `countsOnly=1`: solo los números (el menú lateral no
 * necesita la lista). `generalMode`: para marcar solo los chats en otro modo.
 */
export const GET = withStaff("read", async ({ req }) => {
  if (!(await isWhatsAppWorkspaceAvailable())) return apiError("whatsapp_disabled", 404);
  const url = new URL(req.url);
  if (url.searchParams.get("countsOnly") === "1") {
    return NextResponse.json({ counts: await queueCounts() });
  }
  const requested = url.searchParams.get("queue") as ChatQueue | null;
  const queue: ChatQueue = requested && QUEUES.has(requested) ? requested : "attention";
  const [items, counts, config] = await Promise.all([
    listChats({
      queue,
      q: url.searchParams.get("q") ?? undefined,
      // «Ver más chats»: de 60 en 60, hasta 600.
      take: Math.min(600, Math.max(20, Number(url.searchParams.get("take")) || 60)),
    }),
    queueCounts(),
    getWhatsAppAiConfig(),
  ]);
  return NextResponse.json({ items, counts, generalMode: config.defaultMode });
});
