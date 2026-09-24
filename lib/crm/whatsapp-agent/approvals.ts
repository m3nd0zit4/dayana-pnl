import { Prisma } from "@prisma/client";

import { recipientFromContact, sendWhatsAppToRecipient } from "../whatsapp-outbound";
import { approvedTemplateFor } from "../whatsapp-templates";
import { approvalDelivery, type ApprovalDelivery } from "../whatsapp-outbound-plan";
import { buildContactWhatsAppUrl } from "@/lib/whatsapp-contact";
import { prisma } from "@/lib/db";
import { sendMetaMessage } from "@/lib/meta/send";
import { fireNotification } from "@/lib/notifications/platform/emit";
import { getSiteUrl } from "@/lib/site-url";
import { getOperationalTimezone } from "../operational-timezone";
import { getWhatsAppAiConfig } from "../whatsapp-ai-config";
import { resumeAutoReply } from "../whatsapp-autoreply";
import { bookOnCalendar } from "./calendar";

/**
 * Lo que la IA propone y Dayana autoriza.
 *
 * Tres cosas nunca salen sin su «sí», esté el chat en IA o en copiloto:
 * - agendar una cita (queda en su calendario y le llega a la persona);
 * - mandar un enlace de pago;
 * - responder a alguien que dice que ya pagó (hay que verificarlo primero).
 * Además, en modo copiloto, cada respuesta de la IA espera aquí.
 *
 * Cada propuesta vive en su `WhatsAppAiRun` (`status: AWAITING_APPROVAL`,
 * `proposal`). En el chat aparece encima de la caja de escribir con
 * Aceptar · Modificar · Cancelar. Si Dayana contesta ella misma (desde el CRM o
 * desde el celular), las propuestas pendientes de ese chat se retiran solas:
 * ya no son la respuesta a lo último que pasó.
 */

import { PAYMENT_PLACEHOLDER } from "./placeholders";

export { PAYMENT_PLACEHOLDER };

export type ProposalKind = "reply" | "booking" | "payment_link" | "payment_received";

export type Proposal = {
  kind: ProposalKind;
  /** El mensaje que se enviaría. En un enlace de pago lleva el marcador. */
  message: string;
  booking?: {
    service: string;
    startIso: string;
    durationMin: number;
    name: string | null;
    label: string;
  };
  payment?: { productId: string; product: string };
  stickerUrl?: string | null;
  /** Por qué la IA escaló (pagos recibidos). */
  reason?: string;
  /** Cuándo Dayana lo abrió en su celular (sigue pendiente hasta que llegue). */
  phoneOpenedAt?: string;
  /**
   * Primer mensaje a alguien que nunca escribió (autoevaluación): fuera de
   * las 24 h va con la primera plantilla aprobada de `keys`.
   */
  template?: { keys: string[]; vars: Record<string, string> };
};

export const PENDING = "AWAITING_APPROVAL";

const ownerIds = async (): Promise<string[]> =>
  (
    await prisma.staffUser.findMany({ where: { role: "OWNER", isActive: true }, select: { id: true } })
  ).map((s) => s.id);

/** Retira las propuestas pendientes (y borradores viejos) de un chat. */
export const supersedePending = async (conversationId: string, reason: string): Promise<number> => {
  const { count } = await prisma.whatsAppAiRun.updateMany({
    where: { conversationId, status: { in: [PENDING, "DRAFTED"] } },
    data: { status: "SUPERSEDED", reason, decidedAt: new Date() },
  });
  await prisma.conversation.updateMany({
    where: { id: conversationId, draftSource: "AI" },
    data: { draftBody: null, draftSource: null, draftUpdatedAt: null },
  });
  return count;
};

const TITLES: Record<ProposalKind, string> = {
  reply: "Borrador listo para revisar",
  booking: "Autoriza una cita",
  payment_link: "Autoriza un enlace de pago",
  payment_received: "Confirma un pago",
};

/** Deja la propuesta esperando a Dayana y le avisa (las importantes, al teléfono). */
export const proposeForApproval = async (input: {
  runId: string;
  conversationId: string;
  proposal: Proposal;
  name: string | null;
  meta?: Prisma.WhatsAppAiRunUpdateInput;
}) => {
  // Solo la propuesta más reciente de un chat está viva.
  await prisma.whatsAppAiRun.updateMany({
    where: { conversationId: input.conversationId, status: PENDING, id: { not: input.runId } },
    data: { status: "SUPERSEDED", reason: "Llegó una propuesta más nueva.", decidedAt: new Date() },
  });
  const run = await prisma.whatsAppAiRun.findUnique({
    where: { id: input.runId },
    select: { queuedAt: true },
  });
  const finishedAt = new Date();
  await prisma.whatsAppAiRun.update({
    where: { id: input.runId },
    data: {
      ...input.meta,
      status: PENDING,
      proposal: input.proposal as unknown as Prisma.InputJsonValue,
      finishedAt,
      latencyMs: run ? finishedAt.getTime() - run.queuedAt.getTime() : null,
    },
  });

  const p = input.proposal;
  if (p.kind === "reply") return; // un borrador de copiloto se ve en la lista; no hace falta sonar
  const config = await getWhatsAppAiConfig();
  const who = input.name ?? "una persona";
  fireNotification({
    eventType: "WHATSAPP_AI_APPROVAL",
    title: `${TITLES[p.kind]}: ${who}`,
    body:
      p.kind === "booking" && p.booking
        ? `${p.booking.service} · ${p.booking.label}`
        : p.kind === "payment_link" && p.payment
          ? `Enlace de pago · ${p.payment.product}`
          : (p.reason ?? p.message).slice(0, 200),
    href: `/admin/whatsapp?conversation=${input.conversationId}`,
    entityType: "Conversation",
    entityId: input.conversationId,
    staff: config.notify === "OWNERS" ? await ownerIds() : "ALL",
  });
};

export class ApprovalError extends Error {}

const loadPending = async (runId: string, conversationId: string) => {
  const run = await prisma.whatsAppAiRun.findUnique({
    where: { id: runId },
    select: { id: true, conversationId: true, status: true, proposal: true },
  });
  if (!run || run.conversationId !== conversationId) throw new ApprovalError("La propuesta no existe.");
  if (run.status !== PENDING) throw new ApprovalError("Esa propuesta ya no está pendiente.");
  return { ...run, proposal: run.proposal as unknown as Proposal };
};

/**
 * Dayana acepta (tal cual o con su versión del mensaje): se agenda o se crea
 * el enlace, y se envía. Si cambió el texto, cuenta como corrección para que la
 * IA aprenda.
 */
const sendWithTemplate = async (input: {
  conversation: { externalThreadId: string; contactId: string | null; participantName: string | null };
  message: string;
  template: NonNullable<Proposal["template"]>;
  edited: boolean;
  staffId: string;
}): Promise<{ messageId: string }> => {
  let template = null;
  for (const key of input.template.keys) {
    template = await approvedTemplateFor(key);
    if (template) break;
  }
  const c = input.conversation;
  const recipient = (c.contactId ? await recipientFromContact(c.contactId) : null) ?? {
    contactId: c.contactId,
    phoneE164: `+${c.externalThreadId}`,
    name: c.participantName,
    optedOut: false,
  };
  const vars = input.edited
    ? { ...input.template.vars, mensaje: input.message.replace(/\s*\n+\s*/g, " ").trim() }
    : input.template.vars;
  const r = await sendWhatsAppToRecipient({
    recipient,
    text: input.message,
    template,
    vars,
    source: "approval",
    staffId: input.staffId,
  });
  if (r.status === "sent") return { messageId: r.messageId };
  throw new ApprovalError(
    r.status === "skipped"
      ? r.reason === "needs_template"
        ? "Pasaron más de 24 h y la plantilla «Después de la autoevaluación» aún no está aprobada (WhatsApp → Plantillas). Escríbele desde el celular."
        : "No se le puede escribir a este número."
      : r.error
  );
};

/**
 * Cómo saldría esta propuesta si Dayana la acepta ahora. Nunca deja un
 * callejón sin salida: sin ventana ni plantilla aprobada, sale desde su
 * celular (`phone`). Citas y enlaces de pago siempre por el CRM (hay que
 * crear la cita o el enlace).
 */
export const resolveApprovalDelivery = async (
  conversation: { lastInboundAt: Date | null },
  proposal: Proposal
): Promise<ApprovalDelivery> => {
  const windowOpen = Boolean(
    conversation.lastInboundAt && Date.now() - conversation.lastInboundAt.getTime() < 24 * 3600_000
  );
  if (windowOpen || proposal.kind === "booking" || proposal.kind === "payment_link") return "text";
  let hasApprovedTemplate = false;
  for (const key of proposal.template?.keys ?? []) {
    if (await approvedTemplateFor(key)) {
      hasApprovedTemplate = true;
      break;
    }
  }
  return approvalDelivery({ windowOpen, hasApprovedTemplate });
};

/** El enlace que abre el WhatsApp de Dayana con el mensaje escrito. */
export const phoneUrlFor = (phoneDigits: string, message: string): string | null =>
  buildContactWhatsAppUrl(`+${phoneDigits}`, message.split(PAYMENT_PLACEHOLDER).join("").trim());

/**
 * Dayana lo manda desde su celular: la propuesta queda aprobada (sin enviar
 * nada desde el CRM). Cuando ella pulse enviar en su WhatsApp, el mensaje
 * llega aquí solo (coexistencia) y queda en el chat.
 */
export const approveByPhone = async (input: {
  runId: string;
  conversationId: string;
  staffId: string;
  message?: string | null;
}): Promise<{ ok: true; url: string | null }> => {
  const run = await loadPending(input.runId, input.conversationId);
  const p = run.proposal;
  const message = (input.message?.trim() || p.message).trim();
  const conversation = await prisma.conversation.findUnique({
    where: { id: input.conversationId },
    select: { externalThreadId: true },
  });
  if (!conversation) throw new ApprovalError("El chat no existe.");
  // No se da por enviada: queda pendiente hasta que el mensaje llegue desde su
  // WhatsApp (el eco la retira). Si se abrió en un teléfono que no es el de
  // Dayana, sigue aquí y se ve que no salió.
  await prisma.whatsAppAiRun.update({
    where: { id: run.id },
    data: {
      proposal: { ...p, message, phoneOpenedAt: new Date().toISOString() } as unknown as Prisma.InputJsonValue,
    },
  });
  return { ok: true, url: phoneUrlFor(conversation.externalThreadId, message) };
};

export const approveProposal = async (input: {
  runId: string;
  conversationId: string;
  staffId: string;
  message?: string | null;
}): Promise<{ ok: true; sent: string }> => {
  const run = await loadPending(input.runId, input.conversationId);
  const p = run.proposal;
  const edited = input.message?.trim() && input.message.trim() !== p.message.trim();
  let message = (input.message?.trim() || p.message).trim();

  const conversation = await prisma.conversation.findUnique({
    where: { id: input.conversationId },
    select: { externalThreadId: true, contactId: true, participantName: true, lastInboundAt: true },
  });
  if (!conversation) throw new ApprovalError("El chat no existe.");
  if ((await resolveApprovalDelivery(conversation, p)) === "phone") {
    throw new ApprovalError("needs_phone");
  }

  if (p.kind === "booking" && p.booking) {
    const config = await getWhatsAppAiConfig();
    const timezone = await getOperationalTimezone();
    const start = new Date(p.booking.startIso);
    const created = await bookOnCalendar({
      config: config.booking,
      timezone,
      start,
      durationMin: p.booking.durationMin,
      service: p.booking.service,
      name: p.booking.name,
      phone: conversation.externalThreadId,
      conversationId: input.conversationId,
      contactId: conversation.contactId,
    });
    await prisma.whatsAppBooking.create({
      data: {
        conversationId: input.conversationId,
        contactId: conversation.contactId,
        phone: conversation.externalThreadId,
        name: p.booking.name,
        service: p.booking.service,
        startsAt: start,
        endsAt: created.end,
        googleAccountId: created.accountId,
        calendarEventId: created.eventId,
        meetUrl: created.meetUrl,
        eventUrl: created.eventUrl,
      },
    });
    if (created.meetUrl && !message.includes(created.meetUrl)) {
      message = `${message}\n\nEnlace de la videollamada: ${created.meetUrl}`;
    }
    fireNotification({
      eventType: "WHATSAPP_AI_BOOKED",
      title: `Cita agendada: ${created.title}`,
      body: `${p.booking.service} · ${p.booking.label}${created.meetUrl ? ` · ${created.meetUrl}` : ""}`,
      href: `/admin/whatsapp?conversation=${input.conversationId}`,
      entityType: "Conversation",
      entityId: input.conversationId,
      staff: [input.staffId],
    });
  }

  if (p.kind === "payment_link" && p.payment) {
    const { createPaymentLink } = await import("@/lib/crm/payment-links");
    const link = await createPaymentLink({
      contactId: conversation.contactId,
      productId: p.payment.productId,
      note: "Enviado por el asistente de WhatsApp",
      expiresInDays: 14,
      staffUserId: input.staffId,
    });
    const url = `${getSiteUrl()}/pagar/${link.token}`;
    message = message.includes(PAYMENT_PLACEHOLDER)
      ? message.split(PAYMENT_PLACEHOLDER).join(url)
      : `${message}\n\n${url}`;
  }
  message = message.split(PAYMENT_PLACEHOLDER).join("").trim();

  const result = p.template
    ? await sendWithTemplate({
        conversation,
        message,
        template: p.template,
        edited: Boolean(edited),
        staffId: input.staffId,
      })
    : await sendMetaMessage({
        conversationId: input.conversationId,
        body: message,
        staffUserId: input.staffId,
        source: "approval",
      });
  // Tal cual la escribió la IA: cuenta como respuesta de la IA. Si Dayana la
  // cambió, es suya (y la IA aprende de la diferencia).
  await prisma.conversationMessage.update({
    where: { id: result.messageId },
    data: { isAutoReply: !edited },
  });
  if (p.stickerUrl && !edited) {
    await sendMetaMessage({
      conversationId: input.conversationId,
      body: "",
      attachment: { url: p.stickerUrl, mimeType: "image/webp", filename: "sticker.webp", kind: "sticker" },
    }).catch(() => undefined);
  }

  await prisma.whatsAppAiRun.update({
    where: { id: run.id },
    data: {
      proposal: { ...p, sentMessageId: result.messageId } as unknown as Prisma.InputJsonValue,
      status: "APPROVED",
      reason: edited ? "Aprobada con cambios de Dayana." : "Aprobada tal cual.",
      decidedAt: new Date(),
      decidedById: input.staffId,
    },
  });
  // Un pago confirmado o una cita aprobada: el chat vuelve a la IA.
  if (p.kind === "payment_received") await resumeAutoReply(input.conversationId);
  await prisma.conversation.update({
    where: { id: input.conversationId },
    data: { draftBody: null, draftSource: null, draftUpdatedAt: null },
  });

  if (edited) {
    const { learnFromLatestReply } = await import("../whatsapp-learning");
    await learnFromLatestReply(input.conversationId).catch(() => undefined);
    const { learnFromCorrection } = await import("./corrections");
    await learnFromCorrection({
      conversationId: input.conversationId,
      aiReply: p.message,
      dayanaReply: message,
    }).catch(() => undefined);
  }
  return { ok: true, sent: message };
};

export const cancelProposal = async (input: {
  runId: string;
  conversationId: string;
  staffId: string;
}): Promise<void> => {
  const run = await loadPending(input.runId, input.conversationId);
  await prisma.whatsAppAiRun.update({
    where: { id: run.id },
    data: { status: "CANCELLED", reason: "Dayana la canceló.", decidedAt: new Date(), decidedById: input.staffId },
  });
};

/**
 * Mensajes que salieron por una aprobación en un chat desde `since`. Aunque
 * Dayana los haya cambiado (y entonces cuentan como suyos para aprender), no
 * son «Dayana tomó el chat»: la IA no debe apartarse por ellos.
 */
export const approvedMessageIds = async (conversationId: string, since: Date): Promise<Set<string>> => {
  const runs = await prisma.whatsAppAiRun.findMany({
    where: { conversationId, status: "APPROVED", decidedAt: { gte: since } },
    select: { proposal: true },
  });
  return new Set(
    runs
      .map((r) => (r.proposal as { sentMessageId?: string } | null)?.sentMessageId)
      .filter((id): id is string => Boolean(id))
  );
};
