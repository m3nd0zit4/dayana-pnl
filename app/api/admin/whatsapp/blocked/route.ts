import { NextResponse } from "next/server";
import { z } from "zod";

import { withStaff } from "@/lib/api/handler";
import { fireAuditLog } from "@/lib/crm/audit";
import {
  blockOnWhatsApp,
  listBlockedNumbers,
  noteBlockActions,
  recordBlock,
  setNumberHidden,
  syncBlockList,
} from "@/lib/crm/whatsapp-blocked-numbers";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * Números bloqueados en WhatsApp (sin números: huella corta, motivo, fechas,
 * qué se hizo). Para Dayana: cuáles faltan por reportar desde su app.
 */
export const GET = withStaff("read", async () => {
  const rows = await listBlockedNumbers();
  return NextResponse.json({
    rows: rows.map((r) => ({ ...r, phoneHash: r.phoneHash.slice(0, 8) })),
  });
});

const bodySchema = z.discriminatedUnion("action", [
  // Leer ya la lista de bloqueados de WhatsApp (el reloj lo hace cada 30 min).
  z.object({ action: z.literal("sync") }),
  // Bloquear desde el CRM el número de un chat (si bloquear en la app no llega a la lista de la API).
  z.object({ action: z.literal("block_chat"), conversationId: z.string().min(6).max(80) }),
  // Contenido sexual que el filtro no vio: aviso, bloqueo, chat borrado (lo mismo que el automático).
  z.object({ action: z.literal("sexual_content"), conversationId: z.string().min(6).max(80) }),
]);

export const POST = withStaff("owner", async ({ req, staff }) => {
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_body" }, { status: 400 });

  if (parsed.data.action === "sync") {
    try {
      const result = await syncBlockList();
      return NextResponse.json({ ok: true, result });
    } catch (e) {
      return NextResponse.json(
        { error: "sync_failed", message: e instanceof Error ? e.message.slice(0, 300) : String(e) },
        { status: 502 }
      );
    }
  }

  if (parsed.data.action === "sexual_content") {
    const { enforceSexualContent } = await import("@/lib/crm/whatsapp-agent/sexual-content");
    const result = await enforceSexualContent({
      conversationId: parsed.data.conversationId,
      signal: { source: "staff", reason: staff.id.slice(0, 12) },
    });
    if (result.status === "skipped") return NextResponse.json({ error: result.reason }, { status: 404 });
    return NextResponse.json({ ok: true, result });
  }

  const conv = await prisma.conversation.findUnique({
    where: { id: parsed.data.conversationId },
    select: { id: true, channel: true, externalThreadId: true },
  });
  if (!conv || conv.channel !== "WHATSAPP") return NextResponse.json({ error: "not_found" }, { status: 404 });
  const claim = await recordBlock({ threadId: conv.externalThreadId, reason: "manual", source: "staff" });
  if (!claim) return NextResponse.json({ error: "no_hash" }, { status: 500 });
  if (!claim.created) return NextResponse.json({ ok: true, already: true });
  const api = await blockOnWhatsApp(conv.externalThreadId);
  const hidden = await setNumberHidden(conv.externalThreadId, new Date());
  await noteBlockActions(claim.hash, { hiddenChats: hidden.chats, hiddenContacts: hidden.contacts }, { at: api.ok ? new Date() : null, error: api.error });
  fireAuditLog({
    action: "WHATSAPP_NUMBER_BLOCKED",
    entityType: "WhatsAppBlockedNumber",
    entityId: claim.hash.slice(0, 16),
    staffUserId: staff.id,
    changes: { reason: "manual", apiBlocked: api.ok, apiError: api.error, ...hidden },
  });
  return NextResponse.json({ ok: true, apiBlocked: api.ok, apiError: api.error, hidden });
});
