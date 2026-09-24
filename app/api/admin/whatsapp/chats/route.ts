import { NextResponse } from "next/server";

import { apiError, withStaff } from "@/lib/api/handler";
import {
  isWhatsAppWorkspaceAvailable,
  listChats,
  queueCounts,
  type ChatQueue,
} from "@/lib/crm/whatsapp-agent/workspace";

export const dynamic = "force-dynamic";

const QUEUES = new Set<ChatQueue>(["attention", "mine", "ai", "all"]);

/** Chats de WhatsApp por cola («Te toca», «Tú atiendes», «IA», «Todos»). */
export const GET = withStaff("read", async ({ req }) => {
  if (!(await isWhatsAppWorkspaceAvailable())) return apiError("whatsapp_disabled", 404);
  const url = new URL(req.url);
  const requested = url.searchParams.get("queue") as ChatQueue | null;
  const queue: ChatQueue = requested && QUEUES.has(requested) ? requested : "all";
  const [items, counts] = await Promise.all([
    listChats({
      queue,
      q: url.searchParams.get("q") ?? undefined,
      // «Ver más chats»: de 60 en 60, hasta 600.
      take: Math.min(600, Math.max(20, Number(url.searchParams.get("take")) || 60)),
    }),
    queueCounts(),
  ]);
  return NextResponse.json({ items, counts });
});
