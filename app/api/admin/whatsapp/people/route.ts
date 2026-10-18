import { NextResponse } from "next/server";

import { withStaff } from "@/lib/api/handler";
import { withoutGuessedGender } from "@/lib/crm/whatsapp-agent/dossier-rules";
import { isStage } from "@/lib/crm/whatsapp-agent/stage";
import { chatCategoryWhere, isChatCategoryFilter } from "@/lib/crm/whatsapp-agent/workspace";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * Personas que escribieron, con lo que la IA sabe de cada una (la ficha, o la
 * memoria si no hay ficha) y en qué estado está con Dayana.
 * `category`: solo una categoría (o `unclassified` / `review`).
 * `stage`: solo un estado (`stage.ts`).
 */
export const GET = withStaff("read", async ({ req }) => {
  const url = new URL(req.url);
  const q = url.searchParams.get("q")?.trim();
  const category = url.searchParams.get("category");
  const stage = url.searchParams.get("stage");
  const chats = await prisma.conversation.findMany({
    where: {
      channel: "WHATSAPP",
      AND: [
        q
          ? {
              OR: [
                { participantName: { contains: q, mode: "insensitive" } },
                { externalThreadId: { contains: q.replace(/\D/g, "") || q } },
              ],
            }
          : {},
        chatCategoryWhere(isChatCategoryFilter(category) ? category : null),
        isStage(stage) ? { dossier: { stage } } : {},
      ],
    },
    orderBy: { lastMessageAt: "desc" },
    take: 100,
    select: {
      id: true,
      externalThreadId: true,
      participantName: true,
      contactId: true,
      aiMode: true,
      lastMessageAt: true,
      category: true,
      categoryReview: true,
      categorySource: true,
      contact: { select: { firstName: true, lastName: true } },
      dossier: { select: { stage: true, summary: true } },
      _count: { select: { messages: true, aiBookings: true } },
    },
  });
  const phones = chats.map((c) => c.externalThreadId);
  const [memories, known] = await Promise.all([
    prisma.whatsAppMemory.findMany({ where: { phone: { in: phones } } }),
    prisma.whatsAppKnownContact.findMany({
      where: { phone: { in: phones }, removedAt: null },
      select: { phone: true },
    }),
  ]);
  const memoryBy = new Map(memories.map((m) => [m.phone, m]));
  const knownSet = new Set(known.map((k) => k.phone));
  return NextResponse.json({
    items: chats.map((c) => ({
      conversationId: c.id,
      phone: c.externalThreadId,
      name:
        [c.contact?.firstName, c.contact?.lastName].filter(Boolean).join(" ") ||
        c.participantName ||
        `+${c.externalThreadId}`,
      contactId: c.contactId,
      aiMode: c.aiMode,
      lastMessageAt: c.lastMessageAt.toISOString(),
      messages: c._count.messages,
      bookings: c._count.aiBookings,
      inAddressBook: knownSet.has(c.externalThreadId),
      memory: memoryBy.get(c.externalThreadId)?.notes ?? null,
      memoryUpdatedAt: memoryBy.get(c.externalThreadId)?.updatedAt.toISOString() ?? null,
      category: c.category,
      categoryReview: c.categoryReview && c.categorySource !== "manual",
      stage: c.dossier?.stage ?? null,
      summary: withoutGuessedGender(c.dossier?.summary?.trim() ?? "") || null,
    })),
  });
});
