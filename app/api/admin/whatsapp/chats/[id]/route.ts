import { after, NextResponse } from "next/server";
import { z } from "zod";

import { apiError, readJson, withStaff } from "@/lib/api/handler";
import { fireAuditLog } from "@/lib/crm/audit";
import { markConversationRead, replyToConversation } from "@/lib/crm/conversations";
import { prisma } from "@/lib/db";
import { getOperationalTimezone } from "@/lib/crm/operational-timezone";
import { getWhatsAppAiConfig } from "@/lib/crm/whatsapp-ai-config";
import { draftAutoReply, pauseAutoReply, resumeAutoReply } from "@/lib/crm/whatsapp-autoreply";
import { clientContext } from "@/lib/crm/whatsapp-agent/brain";
import { availableSlots } from "@/lib/crm/whatsapp-agent/calendar";
import { setMemory } from "@/lib/crm/whatsapp-agent/memory";
import { spreadSlots } from "@/lib/crm/whatsapp-agent/slots";
import {
  getChat,
  isWhatsAppWorkspaceAvailable,
  listDayanaStickers,
} from "@/lib/crm/whatsapp-agent/workspace";
import { getTimeHmInTz } from "@/lib/datetime/zoned-time";
import { MetaWindowError } from "@/lib/meta/send";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

type Params = { id: string };

export const GET = withStaff<Params>("read", async ({ params }) => {
  if (!(await isWhatsAppWorkspaceAvailable())) return apiError("whatsapp_disabled", 404);
  const chat = await getChat(params.id);
  if (!chat) return apiError("not_found", 404);
  // Audios de este chat que aún no tienen texto: se transcriben en segundo
  // plano; el panel los muestra en la siguiente actualización.
  if (chat.messages.some((m) => !m.body && m.attachments.some((a) => a.kind === "audio" && a.url))) {
    after(async () => {
      const { transcribePendingAudio } = await import("@/lib/crm/whatsapp-agent/transcribe");
      await transcribePendingAudio({ conversationId: params.id, limit: 30 }).catch(() => undefined);
    });
  }
  return NextResponse.json(chat);
});

const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("send"), body: z.string().trim().min(1).max(4000) }),
  z.object({ action: z.literal("mode"), mode: z.enum(["AUTO", "COPILOT", "MANUAL"]) }),
  /** «Tomar este chat»: lo atiende Dayana y sube a «Tú atiendes». */
  z.object({ action: z.literal("take") }),
  /** Devolverlo a la IA: modo automático, sin pausa ni prioridad. */
  z.object({ action: z.literal("release") }),
  z.object({ action: z.literal("resume") }),
  z.object({ action: z.literal("pause") }),
  z.object({ action: z.literal("priority"), on: z.boolean() }),
  /** Borrador de la IA para lo que hay ahora en el chat. */
  z.object({ action: z.literal("suggest") }),
  /** Texto listo con horas libres del servicio elegido. */
  z.object({ action: z.literal("slots"), service: z.string().trim().max(80).optional() }),
  z.object({ action: z.literal("draft"), body: z.string().max(4000).nullable() }),
  z.object({ action: z.literal("memory"), notes: z.string().max(1500) }),
  z.object({ action: z.literal("read") }),
  /** Aceptar lo que propuso la IA, tal cual o con el mensaje cambiado. */
  z.object({ action: z.literal("approve"), runId: z.string(), message: z.string().max(4000).optional() }),
  z.object({ action: z.literal("reject"), runId: z.string() }),
  /** Reenviar un mensaje que WhatsApp no entregó. */
  z.object({ action: z.literal("resend"), messageId: z.string() }),
  /** Dayana lo envía desde su celular (sin ventana ni plantilla aprobada). */
  z.object({ action: z.literal("approve_phone"), runId: z.string(), message: z.string().max(4000).optional() }),
  /** Foto, documento o nota de voz ya subidos por `/api/admin/inbox/upload`. */
  z.object({
    action: z.literal("attachment"),
    url: z.string().url().max(600),
    mimeType: z.string().max(80),
    filename: z.string().max(200),
    body: z.string().max(1000).optional(),
  }),
  /** Enviar uno de los stickers de Dayana (su URL del store privado). */
  z.object({ action: z.literal("sticker"), url: z.string().url().max(600) }),
]);

export const POST = withStaff<Params>("write", async ({ req, staff, params }) => {
  if (!(await isWhatsAppWorkspaceAvailable())) return apiError("whatsapp_disabled", 404);
  const parsed = actionSchema.safeParse(await readJson(req));
  if (!parsed.success) return apiError("invalid_body", 400);
  const input = parsed.data;
  const id = params.id;

  const conversation = await prisma.conversation.findUnique({
    where: { id },
    select: { id: true, channel: true, externalThreadId: true, contactId: true, participantName: true },
  });
  if (!conversation || conversation.channel !== "WHATSAPP") return apiError("not_found", 404);

  const audit = (changes: Record<string, unknown>) =>
    fireAuditLog({
      staffUserId: staff.id,
      action: "UPDATE",
      entityType: "WhatsAppChat",
      entityId: id,
      changes,
    });

  switch (input.action) {
    case "send": {
      try {
        const result = await replyToConversation({
          conversationId: id,
          body: input.body,
          staffUserId: staff.id,
        });
        return NextResponse.json(result);
      } catch (e) {
        if (e instanceof MetaWindowError) return apiError("window_closed", 409);
        return apiError(e instanceof Error ? e.message : "send_failed", 400);
      }
    }
    case "mode": {
      await prisma.conversation.update({ where: { id }, data: { aiMode: input.mode } });
      if (input.mode !== "MANUAL") await resumeAutoReply(id);
      audit({ aiMode: input.mode });
      return NextResponse.json({ ok: true });
    }
    case "take": {
      await prisma.conversation.update({
        where: { id },
        data: { aiMode: "MANUAL", priorityAt: new Date() },
      });
      audit({ taken: true });
      return NextResponse.json({ ok: true });
    }
    case "release": {
      const config = await getWhatsAppAiConfig();
      await prisma.conversation.update({
        where: { id },
        data: { aiMode: config.defaultMode, priorityAt: null },
      });
      await resumeAutoReply(id);
      audit({ released: true });
      return NextResponse.json({ ok: true });
    }
    case "resume":
      await resumeAutoReply(id);
      audit({ resumed: true });
      return NextResponse.json({ ok: true });
    case "pause":
      await pauseAutoReply(id, "escalation", {
        category: "other",
        severity: "normal",
        reason: "Pausado a mano.",
      });
      audit({ paused: true });
      return NextResponse.json({ ok: true });
    case "priority":
      await prisma.conversation.update({
        where: { id },
        data: { priorityAt: input.on ? new Date() : null },
      });
      return NextResponse.json({ ok: true });
    case "suggest": {
      const config = await getWhatsAppAiConfig();
      const messages = await prisma.conversationMessage.findMany({
        where: { conversationId: id, status: { not: "FAILED" } },
        orderBy: { sentAt: "desc" },
        take: 40,
        select: { direction: true, body: true, isAutoReply: true },
      });
      const draft = await draftAutoReply({
        config,
        transcript: messages.reverse().map((m) => ({
          direction: m.direction === "INBOUND" ? "INBOUND" : "OUTBOUND",
          body: m.body,
          isAutoReply: m.isAutoReply,
        })),
        name: conversation.participantName,
        client: await clientContext(conversation.contactId),
        phone: conversation.externalThreadId,
      });
      if (draft.action === "reply" && draft.message) {
        await prisma.conversation.update({
          where: { id },
          data: { draftBody: draft.message, draftSource: "AI", draftUpdatedAt: new Date() },
        });
      }
      return NextResponse.json({ draft });
    }
    case "slots": {
      const config = await getWhatsAppAiConfig();
      const service =
        config.booking.services.find(
          (s) => s.name.toLowerCase() === input.service?.toLowerCase()
        ) ?? config.booking.services[0];
      const timezone = await getOperationalTimezone();
      try {
        const slots = spreadSlots(
          await availableSlots({ config: config.booking, durationMin: service.minutes, timezone }),
          3
        );
        if (slots.length === 0) {
          return NextResponse.json({ text: "", slots: [] });
        }
        const lines = slots.map((s) => {
          const d = new Date(s.startIso);
          const day = new Intl.DateTimeFormat("es-CO", {
            timeZone: timezone,
            weekday: "long",
            day: "numeric",
            month: "long",
          }).format(d);
          return `• ${day[0].toUpperCase()}${day.slice(1)}, ${getTimeHmInTz(d, timezone)}`;
        });
        return NextResponse.json({
          text: `Tengo estos espacios para ${service.name.toLowerCase()} (${service.minutes} min, hora de Colombia):\n${lines.join("\n")}\n¿Cuál te queda mejor?`,
          slots,
        });
      } catch (e) {
        return apiError(e instanceof Error ? e.message : "calendar_failed", 400);
      }
    }
    case "draft":
      await prisma.conversation.update({
        where: { id },
        data: {
          draftBody: input.body,
          draftSource: input.body ? "STAFF" : null,
          draftUpdatedAt: input.body ? new Date() : null,
        },
      });
      return NextResponse.json({ ok: true });
    case "memory":
      await setMemory(conversation.externalThreadId, input.notes, conversation.contactId);
      audit({ memory: input.notes.length });
      return NextResponse.json({ ok: true });
    case "read":
      await markConversationRead(id);
      return NextResponse.json({ ok: true });
    case "approve": {
      const { approveProposal, ApprovalError } = await import("@/lib/crm/whatsapp-agent/approvals");
      try {
        const result = await approveProposal({
          runId: input.runId,
          conversationId: id,
          staffId: staff.id,
          message: input.message,
        });
        audit({ approved: input.runId, edited: Boolean(input.message) });
        return NextResponse.json(result);
      } catch (e) {
        if (e instanceof MetaWindowError) return apiError("window_closed", 409);
        if (e instanceof ApprovalError) return apiError(e.message, 409);
        const { SlotUnavailableError } = await import("@/lib/crm/whatsapp-agent/calendar");
        if (e instanceof SlotUnavailableError) return apiError(`slot:${e.message}`, 409);
        return apiError(e instanceof Error ? e.message : "approve_failed", 400);
      }
    }
    case "resend": {
      const { resendFailedMessage } = await import("@/lib/crm/whatsapp-resend");
      const owns = await prisma.conversationMessage.findFirst({
        where: { id: input.messageId, conversationId: id },
        select: { id: true },
      });
      if (!owns) return apiError("not_found", 404);
      const result = await resendFailedMessage({ messageId: input.messageId, staffId: staff.id });
      audit({ resend: input.messageId, result: result.status });
      if (result.status === "failed") return apiError(result.error, 409);
      return NextResponse.json(result);
    }
    case "approve_phone": {
      const { approveByPhone, ApprovalError } = await import("@/lib/crm/whatsapp-agent/approvals");
      try {
        const result = await approveByPhone({
          runId: input.runId,
          conversationId: id,
          staffId: staff.id,
          message: input.message,
        });
        audit({ approvedByPhone: input.runId });
        return NextResponse.json(result);
      } catch (e) {
        if (e instanceof ApprovalError) return apiError(e.message, 409);
        throw e;
      }
    }
    case "reject": {
      const { cancelProposal, ApprovalError } = await import("@/lib/crm/whatsapp-agent/approvals");
      try {
        await cancelProposal({ runId: input.runId, conversationId: id, staffId: staff.id });
        audit({ rejected: input.runId });
        return NextResponse.json({ ok: true });
      } catch (e) {
        if (e instanceof ApprovalError) return apiError(e.message, 409);
        throw e;
      }
    }
    case "attachment": {
      // Solo archivos que subió el propio CRM (store privado, carpeta de salida).
      let path = "";
      try {
        path = new URL(input.url).pathname.replace(/^\//, "");
      } catch {
        return apiError("invalid_url", 400);
      }
      if (!/^inbox\/outbound\/[A-Za-z0-9-]+\.[a-z0-9]{2,5}$/.test(path)) return apiError("invalid_url", 400);
      try {
        const result = await replyToConversation({
          conversationId: id,
          body: input.body?.trim() ?? "",
          staffUserId: staff.id,
          attachment: { url: input.url, mimeType: input.mimeType, filename: input.filename },
        });
        return NextResponse.json(result);
      } catch (e) {
        if (e instanceof MetaWindowError) return apiError("window_closed", 409);
        return apiError(e instanceof Error ? e.message : "send_failed", 400);
      }
    }
    case "sticker": {
      // Solo stickers que ya están en la biblioteca: la ruta no manda
      // cualquier archivo que alguien escriba.
      const known = (await listDayanaStickers(500)).some((s) => s.url === input.url);
      if (!known) return apiError("unknown_sticker", 400);
      try {
        const result = await replyToConversation({
          conversationId: id,
          body: "",
          staffUserId: staff.id,
          attachment: {
            url: input.url,
            mimeType: "image/webp",
            filename: "sticker.webp",
            kind: "sticker",
          },
        });
        return NextResponse.json(result);
      } catch (e) {
        if (e instanceof MetaWindowError) return apiError("window_closed", 409);
        return apiError(e instanceof Error ? e.message : "send_failed", 400);
      }
    }
  }
});
