import { del } from "@vercel/blob";

import { prisma } from "@/lib/db";
import { fireAuditLog } from "@/lib/crm/audit";
import { fireNotification } from "@/lib/notifications/platform/emit";
import { contactPhoneCandidates, isWhatsAppUserId, whatsAppIdVariants } from "@/lib/whatsapp-contact";

import {
  blockOnWhatsApp,
  noteBlockActions,
  recordBlock,
  setNumberHidden,
} from "../whatsapp-blocked-numbers";
import { isIgnoredNumber } from "../whatsapp-ignored-numbers";
import { SEXUAL_CONTENT_NOTICE, signalLabel, sparedFromAutoBlock, type SexualSignal } from "./sexual-content-rules";

/**
 * Lo que pasa cuando alguien manda contenido sexual (owner, 8-nov), en este
 * orden:
 * 1. Se anota el bloqueo (es el reclamo: una ráfaga de tres fotos lo hace una
 *    sola vez; desde aquí nada más le sale a ese número).
 * 2. UN mensaje: «Este número va a ser reportado a WhatsApp y Meta debido a
 *    estas acciones…» (dentro de la ventana de 24 h: acaba de escribir).
 * 3. Bloqueo en WhatsApp por la API (`POST /block_users`).
 * 4. Se borra el chat del CRM: mensajes, archivos en Blob, la cola de avisos
 *    con su texto. El contacto se oculta (nunca se borra: si tiene pagos o
 *    inscripciones, el dinero no se toca). Queda solo la fila de bloqueo:
 *    huella del número, fecha, motivo y conteos, sin contenido.
 * 5. Aviso a Dayana (push): qué se hizo y que REPORTAR solo se puede desde su
 *    app (no existe API para reportar a una persona).
 *
 * Un número personal de Dayana o de su equipo no se bloquea solo: el archivo
 * no se guarda igual y ella recibe el aviso para decidir.
 */

export type EnforceResult =
  | { status: "blocked"; noticeSent: boolean; apiBlocked: boolean; deletedChats: number; deletedMessages: number }
  | { status: "already"; deletedChats: number }
  | { status: "spared"; reason: string }
  | { status: "skipped"; reason: string };

export type EnforceDeps = {
  /** Para pruebas: el envío del aviso (por defecto `sendMetaMessage` con `allowBlocked`). */
  sendNotice?: (conversationId: string, body: string) => Promise<{ sent: boolean; error?: string }>;
  /** Para pruebas: el bloqueo en WhatsApp. */
  blockApi?: (threadId: string) => Promise<{ ok: boolean; error: string | null }>;
  /** Para pruebas: borrar archivos de Blob. */
  deleteBlobs?: (urls: string[]) => Promise<void>;
  /** Sin push (pruebas). */
  silent?: boolean;
};

const defaultSendNotice = async (conversationId: string, body: string) => {
  const { sendMetaMessage } = await import("@/lib/meta/send");
  try {
    const r = await sendMetaMessage({
      conversationId,
      body,
      source: "sistema:bloqueo",
      isAutoReply: true,
      clientKey: `bloqueo:${conversationId}`,
      allowBlocked: true,
    });
    if (r.dryRun) return { sent: false, error: "dry_run" };
    const row = await prisma.conversationMessage.findUnique({ where: { id: r.messageId }, select: { status: true, failedReason: true } });
    if (row?.status === "FAILED") return { sent: false, error: row.failedReason ?? "failed" };
    return { sent: true };
  } catch (e) {
    return { sent: false, error: e instanceof Error ? e.message.slice(0, 200) : String(e) };
  }
};

const blobUrlsOf = (attachments: unknown): string[] =>
  (Array.isArray(attachments) ? attachments : [])
    .map((a) => (a && typeof a === "object" ? (a as { url?: unknown }).url : null))
    .filter((u): u is string => typeof u === "string" && /blob\.vercel-storage\.com/.test(u));

/**
 * Borra del CRM los chats de ese número: archivos en Blob, la cola de avisos
 * de sus mensajes (guarda el texto normalizado) y los chats (en cascada:
 * mensajes, corridas de la IA, expediente, propuestas…). Oculta el contacto.
 */
export const purgeNumberFromCrm = async (
  threadId: string,
  deps: Pick<EnforceDeps, "deleteBlobs"> = {}
): Promise<{ chats: number; messages: number; blobs: number; inboxEvents: number; contacts: number }> => {
  const chats = await prisma.conversation.findMany({
    where: { channel: "WHATSAPP", externalThreadId: { in: whatsAppIdVariants(threadId) } },
    select: { id: true, contactId: true },
  });
  const ids = chats.map((c) => c.id);
  // Primero el contacto oculto (si el chat está ligado a uno, ese también).
  const hidden = await setNumberHidden(threadId, new Date());
  if (ids.length === 0) return { chats: 0, messages: 0, blobs: 0, inboxEvents: 0, contacts: hidden.contacts };

  const messages = await prisma.conversationMessage.findMany({
    where: { conversationId: { in: ids } },
    select: { externalMessageId: true, attachments: true },
  });
  const urls = [...new Set(messages.flatMap((m) => blobUrlsOf(m.attachments)))];
  if (urls.length) {
    await (deps.deleteBlobs ?? (async (u: string[]) => void (await del(u))))(urls).catch((e: unknown) =>
      console.warn("[contenido] no se pudieron borrar archivos de Blob", e instanceof Error ? e.message : e)
    );
  }
  const wamids = messages.map((m) => m.externalMessageId).filter((w): w is string => Boolean(w));
  let inboxEvents = 0;
  if (wamids.length) {
    const events = await prisma.metaInboxEvent.findMany({ where: { wamid: { in: wamids } }, select: { id: true, payloadId: true } });
    const r = await prisma.metaInboxEvent.deleteMany({ where: { id: { in: events.map((e) => e.id) } } });
    inboxEvents = r.count;
    // El aviso crudo de Meta (con el texto) si ya no lo usa otro evento.
    const payloadIds = [...new Set(events.map((e) => e.payloadId).filter((p): p is string => Boolean(p)))];
    for (const pid of payloadIds) {
      const still = await prisma.metaInboxEvent.count({ where: { payloadId: pid } });
      if (still === 0) await prisma.metaWebhookPayload.delete({ where: { id: pid } }).catch(() => undefined);
    }
  }
  // Las citas guardan el id del chat sin relación: quedan sin chat.
  await prisma.calendarAppointment.updateMany({ where: { conversationId: { in: ids } }, data: { conversationId: null } }).catch(() => undefined);
  const deleted = await prisma.conversation.deleteMany({ where: { id: { in: ids } } });
  return { chats: deleted.count, messages: messages.length, blobs: urls.length, inboxEvents, contacts: hidden.contacts };
};

const prettyNumber = (threadId: string): string => (isWhatsAppUserId(threadId) ? threadId : `+${threadId.replace(/\D/g, "")}`);

/**
 * Aplica la regla a un chat. Idempotente: si el número ya estaba bloqueado por
 * esto, solo vuelve a limpiar (un mensaje de la misma ráfaga pudo recrear el
 * chat mientras se borraba).
 */
export const enforceSexualContent = async (
  input: { conversationId: string; signal: SexualSignal },
  deps: EnforceDeps = {}
): Promise<EnforceResult> => {
  const conv = await prisma.conversation.findUnique({
    where: { id: input.conversationId },
    select: {
      id: true,
      channel: true,
      externalThreadId: true,
      participantName: true,
      category: true,
      contact: { select: { firstName: true, lastName: true } },
    },
  });
  if (!conv) return { status: "skipped", reason: "no_conversation" };
  if (conv.channel !== "WHATSAPP") return { status: "skipped", reason: "not_whatsapp" };
  const threadId = conv.externalThreadId;
  const label = signalLabel(input.signal);
  const who =
    [conv.contact?.firstName, conv.contact?.lastName].filter(Boolean).join(" ").trim() || conv.participantName?.trim() || "Sin nombre";

  const personalNumber = await isIgnoredNumber(threadId);
  if (sparedFromAutoBlock({ personalNumber, category: conv.category })) {
    if (!deps.silent) {
      fireNotification({
        eventType: "WHATSAPP_NUMBER_BLOCKED",
        title: `Contenido sexual de ${who} (no lo bloqueé)`,
        body: `${prettyNumber(threadId)} está marcado como personal o de tu equipo, así que no lo bloqueé ni borré el chat. El archivo no se guardó en el CRM. Decide tú desde tu WhatsApp.`,
        href: `/admin/whatsapp?chat=${conv.id}`,
        entityType: "Conversation",
        entityId: conv.id,
        staff: "ALL",
      });
    }
    return { status: "spared", reason: personalNumber ? "personal_number" : `category:${conv.category}` };
  }

  const claim = await recordBlock({ threadId, reason: "sexual_content", source: "auto", detail: label });
  if (!claim) return { status: "skipped", reason: "no_hash" };
  if (!claim.created) {
    const purged = claim.reason === "sexual_content" ? await purgeNumberFromCrm(threadId, deps) : { chats: 0 };
    return { status: "already", deletedChats: purged.chats };
  }

  // 2. El aviso (antes del bloqueo: después WhatsApp ya no lo deja salir).
  const notice = await (deps.sendNotice ?? defaultSendNotice)(conv.id, SEXUAL_CONTENT_NOTICE);
  // 3. El bloqueo en WhatsApp.
  const api = await (deps.blockApi ?? blockOnWhatsApp)(threadId);
  // 4. Fuera del CRM.
  const purged = await purgeNumberFromCrm(threadId, deps);
  await noteBlockActions(
    claim.hash,
    {
      noticeSent: notice.sent,
      ...(notice.error ? { noticeError: notice.error.slice(0, 120) } : {}),
      deletedChats: purged.chats,
      deletedMessages: purged.messages,
      deletedFiles: purged.blobs,
      hiddenContacts: purged.contacts,
      reportedToMeta: false,
    },
    { at: api.ok ? new Date() : null, error: api.error }
  );
  fireAuditLog({
    action: "WHATSAPP_NUMBER_BLOCKED",
    entityType: "WhatsAppBlockedNumber",
    entityId: claim.hash.slice(0, 16),
    changes: { reason: "sexual_content", signal: label, noticeSent: notice.sent, apiBlocked: api.ok, apiError: api.error, ...purged },
  });

  // 5. Dayana.
  if (!deps.silent) {
    const done = [
      notice.sent ? "le avisé que su número será reportado" : "no pude mandarle el aviso",
      api.ok ? "lo bloqueé en WhatsApp" : "WhatsApp no dejó bloquearlo por la API",
      "borré el chat del CRM",
    ].join(", ");
    fireNotification({
      eventType: "WHATSAPP_NUMBER_BLOCKED",
      title: `Bloqueé a ${who} por contenido sexual`,
      body: `${prettyNumber(threadId)} mandó contenido sexual: ${done}. Falta REPORTARLO (solo se puede desde tu app): abre ese chat en tu WhatsApp Business, toca el nombre → «Reportar»${api.ok ? "" : " → «Bloquear y reportar»"}.`,
      href: "/admin/whatsapp/ajustes?tab=avanzado#wa-blocked",
      entityType: "WhatsAppBlockedNumber",
      entityId: claim.hash.slice(0, 16),
      staff: "ALL",
    });
  }
  return { status: "blocked", noticeSent: notice.sent, apiBlocked: api.ok, deletedChats: purged.chats, deletedMessages: purged.messages };
};

/** Para buscar contactos del número desde scripts (Roldán). */
export const contactsOfNumber = (threadId: string) =>
  prisma.contact.findMany({ where: { phoneE164: { in: contactPhoneCandidates(threadId) } }, select: { id: true, firstName: true } });
