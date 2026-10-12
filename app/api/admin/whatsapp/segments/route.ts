import { NextResponse } from "next/server";
import { z } from "zod";

import { apiError, readJson, withStaff } from "@/lib/api/handler";
import { computeSegment, listSegmentReview, markClient } from "@/lib/crm/whatsapp-agent/segment-store";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";
export const maxDuration = 90;

const COMPUTE_BUDGET_MS = 50_000;

/** Cuántos chats hay de cada segmento y la lista «por revisar» (tratadas como clientas por duda). */
export const GET = withStaff("read", async () => {
  const [groups, review] = await Promise.all([
    prisma.whatsAppDossier.groupBy({ by: ["segment"], _count: { _all: true }, where: { conversation: { channel: "WHATSAPP" } } }),
    listSegmentReview(),
  ]);
  return NextResponse.json({
    counts: Object.fromEntries(groups.map((g) => [g.segment ?? "none", g._count._all])),
    review,
  });
});

const bodySchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("mark"),
    conversationId: z.string().min(1),
    /** true = es clienta, false = no lo es, null = quitar la marca. */
    isClient: z.boolean().nullable(),
  }),
  z.object({ action: z.literal("compute") }),
]);

/**
 * - `mark`: la marca de Dayana (es clienta / no lo es / quitar).
 * - `compute`: calcula el segmento de los chats que no lo tienen o que
 *   tienen mensajes nuevos, durante ~50 s; la pantalla repite hasta terminar.
 */
export const POST = withStaff("write", async ({ req, staff }) => {
  const parsed = bodySchema.safeParse(await readJson(req));
  if (!parsed.success) return apiError("invalid_request", 400);
  const body = parsed.data;

  if (body.action === "mark") {
    const verdict = await markClient(body.conversationId, body.isClient, staff.id);
    if (!verdict) return apiError("not_found", 404);
    return NextResponse.json({ verdict });
  }

  const deadline = Date.now() + COMPUTE_BUDGET_MS;
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    SELECT c.id FROM conversations c
    LEFT JOIN whatsapp_dossiers d ON d.conversation_id = c.id
    WHERE c.channel = 'WHATSAPP'
      AND (d.segment IS NULL OR d.segment_at IS NULL OR d.segment_at < c.last_message_at OR d.segment_at < d.updated_at - interval '1 second')
    ORDER BY c.last_message_at DESC
    LIMIT 400`;
  let done = 0;
  for (const { id } of rows) {
    if (Date.now() > deadline) break;
    await computeSegment(id).catch((e: unknown) => console.warn("[segmento] no se pudo calcular", id, e));
    done++;
  }
  return NextResponse.json({ computed: done, remaining: rows.length - done });
});
