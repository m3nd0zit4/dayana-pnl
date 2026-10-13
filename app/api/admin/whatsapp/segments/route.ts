import { NextResponse } from "next/server";
import { z } from "zod";

import { apiError, readJson, withStaff } from "@/lib/api/handler";
import { listSegmentReview, markClient, refreshStages } from "@/lib/crm/whatsapp-agent/segment-store";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";
export const maxDuration = 90;

const COMPUTE_BUDGET_MS = 50_000;

/** Cuántos chats hay de cada segmento y de cada estado, y la lista «por revisar» (tratadas como clientas por duda). */
export const GET = withStaff("read", async () => {
  const where = { conversation: { channel: "WHATSAPP" as const } };
  const [groups, stages, review] = await Promise.all([
    prisma.whatsAppDossier.groupBy({ by: ["segment"], _count: { _all: true }, where }),
    prisma.whatsAppDossier.groupBy({ by: ["stage"], _count: { _all: true }, where }),
    listSegmentReview(),
  ]);
  return NextResponse.json({
    counts: Object.fromEntries(groups.map((g) => [g.segment ?? "none", g._count._all])),
    stages: Object.fromEntries(stages.map((g) => [g.stage ?? "none", g._count._all])),
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
 * - `compute`: calcula el segmento y el estado de los chats que no lo tienen,
 *   que tienen mensajes nuevos o cuya llamada ya pasó, durante ~50 s; la
 *   pantalla repite hasta terminar.
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

  return NextResponse.json(await refreshStages(COMPUTE_BUDGET_MS));
});
