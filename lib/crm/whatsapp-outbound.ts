import { whatsAppDigits } from "@/lib/whatsapp-contact";
import { prisma } from "@/lib/db";
import { sendMetaMessage, MetaWindowError, type SendAttachment } from "@/lib/meta/send";
import { resolveWindow } from "@/lib/meta/window";
import { resolveWhatsAppCredentials } from "@/lib/meta/whatsapp-provider";
import { writeAuditLog } from "./audit";
import { recordContactTouch } from "./whatsapp-touches";
import { fillVars, firstName, planSend, templateParams, type SendPlan } from "./whatsapp-outbound-plan";
import { approvedTemplateFor, type WaTemplate } from "./whatsapp-templates";

/**
 * Enviar WhatsApp de verdad desde cualquier parte del CRM (no abrir wa.me).
 *
 * Todo mensaje que sale de aquí queda en el chat de esa persona (sección
 * WhatsApp), con sus confirmaciones de entregado y leído, y se sabe si
 * respondió. Dentro de las 24 h desde su último mensaje va como texto libre
 * (gratis); fuera, con la plantilla aprobada de su clave (se cobra), y si no
 * hay plantilla aprobada no se envía.
 */

const digits = (phone: string) => phone.replace(/\D/g, "");

/** El chat de WhatsApp de un número; lo crea si nunca hubo conversación. */
export const ensureWhatsAppConversation = async (input: {
  phoneE164: string;
  contactId?: string | null;
  name?: string | null;
}): Promise<{ id: string; lastInboundAt: Date | null }> => {
  const threadId = whatsAppDigits(input.phoneE164);
  const legacyId = digits(input.phoneE164);
  // Chats creados antes con el E.164 tal cual (México/Argentina): se pasan al
  // número de WhatsApp para que la respuesta de la persona caiga en el mismo.
  if (legacyId !== threadId) {
    const [current, legacy] = await Promise.all([
      prisma.conversation.findUnique({
        where: { channel_externalThreadId: { channel: "WHATSAPP", externalThreadId: threadId } },
        select: { id: true },
      }),
      prisma.conversation.findUnique({
        where: { channel_externalThreadId: { channel: "WHATSAPP", externalThreadId: legacyId } },
        select: { id: true },
      }),
    ]);
    if (legacy && !current) {
      await prisma.conversation.update({ where: { id: legacy.id }, data: { externalThreadId: threadId } });
    }
  }
  const credentials = await resolveWhatsAppCredentials();
  return prisma.conversation.upsert({
    where: { channel_externalThreadId: { channel: "WHATSAPP", externalThreadId: threadId } },
    create: {
      channel: "WHATSAPP",
      externalThreadId: threadId,
      metaAccountId: credentials?.accountId ?? "unknown",
      contactId: input.contactId ?? null,
      participantName: input.name ?? null,
      lastMessageAt: new Date(),
      status: "PENDING",
    },
    update: {
      ...(input.contactId ? { contactId: input.contactId } : {}),
    },
    select: { id: true, lastInboundAt: true },
  });
};

export type RecipientInfo = {
  contactId: string | null;
  phoneE164: string | null;
  name: string | null;
  optedOut: boolean;
};

export const recipientFromContact = async (contactId: string): Promise<RecipientInfo | null> => {
  const c = await prisma.contact.findUnique({
    where: { id: contactId },
    select: { id: true, phoneE164: true, firstName: true, lastName: true, notifyWhatsapp: true },
  });
  if (!c) return null;
  return {
    contactId: c.id,
    phoneE164: c.phoneE164 && /^\+\d{8,15}$/.test(c.phoneE164) ? c.phoneE164 : null,
    name: [c.firstName, c.lastName].filter(Boolean).join(" ").trim() || null,
    optedOut: c.notifyWhatsapp === false,
  };
};

/** Qué pasaría con esta persona, sin enviar nada (para las vistas previas). */
export const planForRecipient = async (
  r: RecipientInfo,
  template: WaTemplate | null
): Promise<SendPlan> => {
  let windowOpen = false;
  if (r.phoneE164) {
    const conv = await prisma.conversation.findUnique({
      where: { channel_externalThreadId: { channel: "WHATSAPP", externalThreadId: digits(r.phoneE164) } },
      select: { lastInboundAt: true },
    });
    windowOpen = resolveWindow("WHATSAPP", conv?.lastInboundAt ?? null).isOpen;
  }
  return planSend({
    hasPhone: Boolean(r.phoneE164),
    optedOut: r.optedOut,
    windowOpen,
    hasApprovedTemplate: Boolean(template),
  });
};

export type SendResult =
  | { status: "sent"; mode: "text" | "template"; conversationId: string; messageId: string; body: string }
  | { status: "skipped"; reason: "no_phone" | "opted_out" | "needs_template" }
  | { status: "failed"; error: string; conversationId?: string };

/**
 * Envía a una persona. `text` es el mensaje libre (con {{nombre}}, {{enlace}}…);
 * `templateKey` la plantilla para cuando ya pasaron las 24 h.
 */
export const sendWhatsAppToRecipient = async (input: {
  recipient: RecipientInfo;
  text: string;
  templateKey?: string | null;
  vars?: Record<string, string | null | undefined>;
  attachment?: SendAttachment | null;
  source: string;
  staffId?: string | null;
  template?: WaTemplate | null;
}): Promise<SendResult> => {
  const r = input.recipient;
  const template = input.template !== undefined ? input.template : await approvedTemplateFor(input.templateKey);
  const plan = await planForRecipient(r, template);
  if (plan.action === "skip") return { status: "skipped", reason: plan.reason };

  const vars = { nombre: firstName(r.name), ...(input.vars ?? {}) };
  const conversation = await ensureWhatsAppConversation({
    phoneE164: r.phoneE164!,
    contactId: r.contactId,
    name: r.name,
  });

  const body =
    plan.action === "template" && template
      ? fillVars(template.body, vars)
      : fillVars(input.text, vars);

  try {
    const result = await sendMetaMessage({
      conversationId: conversation.id,
      body,
      staffUserId: input.staffId ?? null,
      source: input.source,
      ...(plan.action === "template" && template
        ? {
            template: {
              name: template.metaTemplateName!,
              language: template.metaTemplateLang ?? "es",
              variables: templateParams(template.metaVarNames, vars),
            },
          }
        : { attachment: input.attachment ?? null }),
    });
    if (r.contactId) {
      await recordContactTouch({
        contactId: r.contactId,
        kind: "STAFF_WHATSAPP",
        source: `crm_api:${input.source}`,
      }).catch(() => undefined);
    }
    return { status: "sent", mode: plan.action, conversationId: conversation.id, messageId: result.messageId, body };
  } catch (e) {
    if (e instanceof MetaWindowError) return { status: "skipped", reason: "needs_template" };
    return {
      status: "failed",
      error: e instanceof Error ? e.message : String(e),
      conversationId: conversation.id,
    };
  }
};

/** Enviar a un contacto del CRM (perfil, pagos, diagnósticos…). */
export const sendWhatsAppToContact = async (input: {
  contactId: string;
  text: string;
  templateKey?: string | null;
  vars?: Record<string, string | null | undefined>;
  attachment?: SendAttachment | null;
  source: string;
  staffId: string;
}): Promise<SendResult> => {
  const recipient = await recipientFromContact(input.contactId);
  if (!recipient) return { status: "failed", error: "El contacto no existe." };
  const result = await sendWhatsAppToRecipient({ ...input, recipient });
  await writeAuditLog({
    staffUserId: input.staffId,
    action: "WHATSAPP_SENT",
    entityType: "Contact",
    entityId: input.contactId,
    changes: {
      source: input.source,
      status: result.status,
      ...(result.status === "sent" ? { mode: result.mode } : {}),
      ...(result.status === "skipped" ? { reason: result.reason } : {}),
    },
  }).catch(() => undefined);
  return result;
};

// ── Estado por persona ─────────────────────────────────────────────────────

export type WhatsAppStatus = {
  lastSentAt: string | null;
  /** SENT | DELIVERED | READ | FAILED del último mensaje que le mandamos. */
  lastStatus: string | null;
  lastSource: string | null;
  /** Primera respuesta suya después de ese mensaje. */
  answeredAt: string | null;
  conversationId: string | null;
};

/** El estado de WhatsApp de muchos contactos a la vez (sin una consulta por fila). */
export const whatsAppStatusFor = async (contactIds: string[]): Promise<Record<string, WhatsAppStatus>> => {
  const ids = [...new Set(contactIds.filter(Boolean))];
  if (ids.length === 0) return {};
  const contacts = await prisma.contact.findMany({
    where: { id: { in: ids } },
    select: { id: true, phoneE164: true },
  });
  const byThread = new Map<string, string>();
  for (const c of contacts) if (c.phoneE164) byThread.set(digits(c.phoneE164), c.id);

  const conversations = await prisma.conversation.findMany({
    where: {
      channel: "WHATSAPP",
      OR: [{ contactId: { in: ids } }, { externalThreadId: { in: [...byThread.keys()] } }],
    },
    select: { id: true, contactId: true, externalThreadId: true },
  });

  const out: Record<string, WhatsAppStatus> = {};
  await Promise.all(
    conversations.map(async (conv) => {
      const contactId = conv.contactId ?? byThread.get(conv.externalThreadId);
      if (!contactId) return;
      const last = await prisma.conversationMessage.findFirst({
        where: { conversationId: conv.id, direction: "OUTBOUND" },
        orderBy: { sentAt: "desc" },
        select: { sentAt: true, status: true, source: true },
      });
      const answer = last
        ? await prisma.conversationMessage.findFirst({
            where: { conversationId: conv.id, direction: "INBOUND", sentAt: { gt: last.sentAt } },
            orderBy: { sentAt: "asc" },
            select: { sentAt: true },
          })
        : null;
      out[contactId] = {
        lastSentAt: last?.sentAt.toISOString() ?? null,
        lastStatus: last?.status ?? null,
        lastSource: last?.source ?? null,
        answeredAt: answer?.sentAt.toISOString() ?? null,
        conversationId: conv.id,
      };
    })
  );
  return out;
};
