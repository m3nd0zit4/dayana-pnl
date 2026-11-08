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
 * Borra del CRM los chats de ese número: los archivos que mandó la persona
 * (Blob), la cola de avisos de sus mensajes (guarda el texto normalizado), los
 * mensajes y los chats. Oculta el contacto (nunca lo borra).
 *
 * Un chat con comprobantes de pago, citas agendadas por la IA o un interés en
 * un taller NO se borra (esas filas cuelgan del chat en cascada y el
 * comprobante está ligado al pago): se borran sus mensajes, corridas de la IA,
 * expediente y ejemplos, y el chat queda oculto (revisión 8-nov). Los archivos
 * salientes no se tocan: un envío masivo usa el mismo archivo en muchos chats.
 */
export const purgeNumberFromCrm = async (
  threadIds: string | string[],
  deps: Pick<EnforceDeps, "deleteBlobs"> = {}
): Promise<{ chats: number; keptChats: number; messages: number; blobs: number; inboxEvents: number; contacts: number }> => {
  const all = (Array.isArray(threadIds) ? threadIds : [threadIds]).filter(Boolean);
  const chats = await prisma.conversation.findMany({
    where: { channel: "WHATSAPP", externalThreadId: { in: [...new Set(all.flatMap(whatsAppIdVariants))] } },
    select: {
      id: true,
      _count: { select: { paymentReceipts: true, aiBookings: true, workshopInterests: true } },
    },
  });
  const ids = chats.map((c) => c.id);
  const now = new Date();
  let contacts = 0;
  for (const t of all) contacts += (await setNumberHidden(t, now)).contacts;
  if (ids.length === 0) return { chats: 0, keptChats: 0, messages: 0, blobs: 0, inboxEvents: 0, contacts };

  const messages = await prisma.conversationMessage.findMany({
    where: { conversationId: { in: ids } },
    select: { externalMessageId: true, attachments: true, direction: true },
  });
  const urls = [...new Set(messages.filter((m) => m.direction === "INBOUND").flatMap((m) => blobUrlsOf(m.attachments)))];
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
  const keep = chats.filter((c) => c._count.paymentReceipts + c._count.aiBookings + c._count.workshopInterests > 0).map((c) => c.id);
  const drop = ids.filter((id) => !keep.includes(id));
  if (keep.length) {
    await prisma.conversationMessage.deleteMany({ where: { conversationId: { in: keep } } });
    await prisma.whatsAppAiRun.deleteMany({ where: { conversationId: { in: keep } } });
    await prisma.whatsAppDossier.deleteMany({ where: { conversationId: { in: keep } } });
    await prisma.whatsAppReplyExample.deleteMany({ where: { conversationId: { in: keep } } });
    await prisma.conversation.updateMany({
      where: { id: { in: keep } },
      data: { blockedAt: now, draftBody: null, escalationReason: null, attentionAt: null, unreadCount: 0 },
    });
  }
  // Las citas guardan el id del chat sin relación: quedan sin chat.
  if (drop.length) {
    await prisma.calendarAppointment.updateMany({ where: { conversationId: { in: drop } }, data: { conversationId: null } }).catch(() => undefined);
  }
  const deleted = drop.length ? await prisma.conversation.deleteMany({ where: { id: { in: drop } } }) : { count: 0 };
  return { chats: deleted.count, keptChats: keep.length, messages: messages.length, blobs: urls.length, inboxEvents, contacts };
};

const prettyNumber = (threadId: string): string => (isWhatsAppUserId(threadId) ? threadId : `+${threadId.replace(/\D/g, "")}`);

/**
 * Aplica la regla a un chat. Idempotente: si el número ya estaba bloqueado por
 * esto, solo vuelve a limpiar (un mensaje de la misma ráfaga pudo recrear el
 * chat mientras se borraba).
 */
export const enforceSexualContent = async (
  input: {
    conversationId: string;
    signal: SexualSignal;
    /** Otros ids de la misma persona en el mensaje (su id de usuario / su número): se bloquean también. */
    altThreadIds?: string[];
  },
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
        href: `/admin/whatsapp?conversation=${conv.id}`,
        entityType: "Conversation",
        entityId: conv.id,
        staff: "ALL",
      });
    }
    return { status: "spared", reason: personalNumber ? "personal_number" : `category:${conv.category}` };
  }

  const source = input.signal.source === "staff" ? "staff" : "auto";
  const claim = await recordBlock({ threadId, reason: "sexual_content", source, detail: label });
  if (!claim) return { status: "skipped", reason: "no_hash" };
  // La misma persona con su otro id (número ↔ id de usuario): no vuelve por ahí.
  const alt = [...new Set((input.altThreadIds ?? []).filter((id) => id && id !== threadId))];
  for (const id of alt) await recordBlock({ threadId: id, reason: "sexual_content", source, detail: label }).catch(() => null);
  if (!claim.created && claim.reason !== "sexual_content") {
    // Ya estaba bloqueado por otra razón (Dayana lo bloqueó en su app antes:
    // Roldán, 8-nov). Pasa a contenido sexual (nunca se suelta solo) y se borra
    // el chat. Sin aviso ni bloqueo por la API: WhatsApp ya no deja escribirle.
    await prisma.whatsAppBlockedNumber.update({
      where: { phoneHash: claim.hash },
      data: { reason: "sexual_content", source, detail: label },
    });
    const purged = await purgeNumberFromCrm([threadId, ...alt], deps);
    await noteBlockActions(claim.hash, {
      upgradedFrom: claim.reason,
      noticeSent: false,
      noticeError: "already_blocked",
      deletedChats: purged.chats,
      keptChats: purged.keptChats,
      deletedMessages: purged.messages,
      deletedFiles: purged.blobs,
      hiddenContacts: purged.contacts,
      reportedToMeta: false,
    });
    fireAuditLog({
      action: "WHATSAPP_NUMBER_BLOCKED",
      entityType: "WhatsAppBlockedNumber",
      entityId: claim.hash.slice(0, 16),
      changes: { reason: "sexual_content", upgradedFrom: claim.reason, signal: label, ...purged },
    });
    if (!deps.silent) {
      fireNotification({
        eventType: "WHATSAPP_NUMBER_BLOCKED",
        title: `Borré el chat de ${who} (contenido sexual)`,
        body: `${prettyNumber(threadId)} ya estaba bloqueado en tu WhatsApp, así que no se le pudo avisar. Borré el chat del CRM. Si no lo reportaste al bloquearlo: abre ese chat en tu WhatsApp Business, toca el nombre → «Reportar».`,
        href: "/admin/whatsapp/ajustes?tab=avanzado#wa-blocked",
        entityType: "WhatsAppBlockedNumber",
        entityId: claim.hash.slice(0, 16),
        staff: "ALL",
      });
    }
    return { status: "blocked", noticeSent: false, apiBlocked: true, deletedChats: purged.chats, deletedMessages: purged.messages };
  }
  if (!claim.created) {
    // Otro mensaje de la misma ráfaga ya lo está bloqueando: mientras manda el
    // aviso no se le borra el chat (el aviso se quedaría sin chat). Pasado un
    // minuto, solo se limpia lo que haya entrado mientras tanto.
    const working = Date.now() - claim.since.getTime() < 60_000;
    const purged = claim.reason === "sexual_content" && !working ? await purgeNumberFromCrm([threadId, ...alt], deps) : { chats: 0 };
    return { status: "already", deletedChats: purged.chats };
  }

  // 2. El aviso (antes del bloqueo: después WhatsApp ya no lo deja salir).
  const notice = await (deps.sendNotice ?? defaultSendNotice)(conv.id, SEXUAL_CONTENT_NOTICE);
  // 3. El bloqueo en WhatsApp.
  const api = await (deps.blockApi ?? blockOnWhatsApp)(threadId);
  // 4. Fuera del CRM.
  const purged = await purgeNumberFromCrm([threadId, ...alt], deps);
  await noteBlockActions(
    claim.hash,
    {
      noticeSent: notice.sent,
      ...(notice.error ? { noticeError: notice.error.slice(0, 120) } : {}),
      deletedChats: purged.chats,
      keptChats: purged.keptChats,
      deletedMessages: purged.messages,
      deletedFiles: purged.blobs,
      hiddenContacts: purged.contacts,
      apiAccepted: api.ok,
      reportedToMeta: false,
    },
    { error: api.error }
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
