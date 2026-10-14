import { NextResponse } from "next/server";
import { z } from "zod";

import { apiError, readJson, withStaff } from "@/lib/api/handler";
import { answerUnansweredChats, findUnansweredChats } from "@/lib/crm/whatsapp-agent/catch-up";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Los chats que se quedaron sin respuesta (dentro de las 24 h de WhatsApp). */
export const GET = withStaff("read", async () => {
  const chats = await findUnansweredChats({ minAgeMin: 2, includeEscalated: true, limit: 100 });
  return NextResponse.json({
    chats: chats.map((c) => ({ conversationId: c.conversationId, name: c.name, lastInboundAt: c.lastInboundAt.toISOString() })),
  });
});

const bodySchema = z.object({ includeEscalated: z.boolean().default(true) });

/** «Contestar pendientes»: la IA los mira como si acabaran de llegar (~3 min por tanda; repetir si quedan). */
export const POST = withStaff("write", async ({ req }) => {
  const parsed = bodySchema.safeParse((await readJson(req)) ?? {});
  if (!parsed.success) return apiError("invalid_request", 400);
  return NextResponse.json(
    await answerUnansweredChats({ budgetMs: 200_000, minAgeMin: 2, includeEscalated: parsed.data.includeEscalated, limit: 60 })
  );
});
