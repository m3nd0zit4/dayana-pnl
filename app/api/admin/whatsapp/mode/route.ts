import { NextResponse } from "next/server";
import { z } from "zod";

import { apiError, readJson, withStaff } from "@/lib/api/handler";
import { fireAuditLog } from "@/lib/crm/audit";
import { prisma } from "@/lib/db";
import { getWhatsAppAiConfig } from "@/lib/crm/whatsapp-ai-config";
import { applyConfigPatch } from "@/lib/crm/whatsapp-agent/config-patch";

export const dynamic = "force-dynamic";

/** El modo general y cuántos chats hay en cada modo. */
export const GET = withStaff("read", async () => {
  const [config, groups] = await Promise.all([
    getWhatsAppAiConfig(),
    prisma.conversation.groupBy({
      by: ["aiMode"],
      where: { channel: "WHATSAPP" },
      _count: { _all: true },
    }),
  ]);
  return NextResponse.json({
    mode: config.defaultMode,
    counts: Object.fromEntries(groups.map((g) => [g.aiMode, g._count._all])),
  });
});

const bodySchema = z.object({ mode: z.enum(["AUTO", "COPILOT", "MANUAL"]) });

/**
 * Modo general: pone TODOS los chats de WhatsApp en ese modo (menos los
 * favoritos ⭐, que la IA nunca toca) y lo deja como modo de los chats nuevos.
 *
 * - AUTO: la IA responde sola.
 * - COPILOT: la IA deja borradores y alguien del equipo los envía.
 * - MANUAL: la IA no escribe en ningún chat.
 *
 * Los chats que la IA pasó a Dayana («Te toca») siguen esperándola: cambiar el
 * modo no borra una escalada.
 */
export const POST = withStaff("write", async ({ req, staff }) => {
  const parsed = bodySchema.safeParse(await readJson(req));
  if (!parsed.success) return apiError("invalid_body", 400);
  const { mode } = parsed.data;

  const result = await applyConfigPatch({ defaultMode: mode });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });

  const updated = await prisma.conversation.updateMany({
    where: { channel: "WHATSAPP", priorityAt: null },
    data: { aiMode: mode },
  });
  // Al volver a IA o copiloto, las pausas por «contestó una persona» se
  // levantan; las escaladas no.
  if (mode !== "MANUAL") {
    await prisma.conversation.updateMany({
      where: { channel: "WHATSAPP", priorityAt: null, aiPausedReason: "human" },
      data: { aiPausedAt: null, aiPausedReason: null },
    });
  }

  fireAuditLog({
    staffUserId: staff.id,
    action: "UPDATE",
    entityType: "WhatsAppAiMode",
    entityId: "all",
    changes: { mode, chats: updated.count },
  });
  return NextResponse.json({ ok: true, mode, chats: updated.count });
});
