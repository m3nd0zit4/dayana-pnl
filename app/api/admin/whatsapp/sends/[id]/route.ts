import { NextResponse } from "next/server";
import { z } from "zod";

import { apiError, readJson, withStaff } from "@/lib/api/handler";
import { prisma } from "@/lib/db";
import { cancelSend, processNextBatch } from "@/lib/crm/whatsapp-sends";

export const dynamic = "force-dynamic";
// Una tanda de 20 mensajes con su respiro cabe de sobra.
export const maxDuration = 120;

type Params = { id: string };

/** Detalle del envío con el estado de cada persona. */
export const GET = withStaff<Params>("read", async ({ params }) => {
  const send = await prisma.whatsAppSend.findUnique({
    where: { id: params.id },
    include: { recipients: { orderBy: { processedAt: "desc" }, take: 500 } },
  });
  if (!send) return apiError("not_found", 404);
  return NextResponse.json(send);
});

const schema = z.object({ action: z.enum(["next", "cancel"]) });

/** `next`: envía la siguiente tanda (la página lo llama hasta terminar). */
export const POST = withStaff<Params>("write", async ({ req, staff, params }) => {
  const parsed = schema.safeParse(await readJson(req));
  if (!parsed.success) return apiError("invalid_body", 400);
  if (parsed.data.action === "cancel") {
    await cancelSend(params.id);
    return NextResponse.json({ ok: true });
  }
  try {
    return NextResponse.json(await processNextBatch(params.id, staff.id));
  } catch (e) {
    return apiError(e instanceof Error ? e.message : "send_failed", 400);
  }
});
