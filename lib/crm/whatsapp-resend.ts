import { prisma } from "@/lib/db";
import { sendMetaMessage, type SendAttachment } from "@/lib/meta/send";
import { buildContactWhatsAppUrl } from "@/lib/whatsapp-contact";
import { windowStateOf } from "./whatsapp-outbound-plan";
import { recipientFromContact, sendWhatsAppToRecipient } from "./whatsapp-outbound";
import { approvedTemplateFor } from "./whatsapp-templates";

/** Plantillas con las que se puede reenviar un texto fuera de las 24 h, en orden. */
const RESEND_TEMPLATE_KEYS = ["autoevaluacion_bienvenida", "retomar_conversacion"];

export type ResendResult =
  | { status: "sent"; messageId: string; mode: "text" | "template" }
  | { status: "phone"; url: string | null; reason: string }
  | { status: "failed"; error: string };

/** Marca en `source` del mensaje nuevo: así el viejo muestra «Reenviado». */
export const resendSource = (originalId: string) => `resend:${originalId}`;

/**
 * Reenvía un mensaje que WhatsApp no entregó, con el mismo texto (y adjunto).
 * Dentro de las 24 h va tal cual; fuera, con una plantilla aprobada; y si no
 * hay, devuelve el enlace para mandarlo desde el WhatsApp de Dayana.
 */
export const resendFailedMessage = async (input: {
  messageId: string;
  staffId: string;
}): Promise<ResendResult> => {
  const original = await prisma.conversationMessage.findUnique({
    where: { id: input.messageId },
    select: {
      id: true,
      direction: true,
      status: true,
      body: true,
      attachments: true,
      isAutoReply: true,
      conversation: {
        select: { id: true, channel: true, externalThreadId: true, lastInboundAt: true, contactId: true, participantName: true },
      },
    },
  });
  if (!original || original.direction !== "OUTBOUND") return { status: "failed", error: "El mensaje no existe." };
  if (original.status !== "FAILED") return { status: "failed", error: "Ese mensaje no falló: no hace falta reenviarlo." };
  const already = await prisma.conversationMessage.findFirst({
    where: { source: resendSource(original.id), status: { not: "FAILED" } },
    select: { id: true },
  });
  if (already) return { status: "failed", error: "Ya se reenvió." };

  const conv = original.conversation;
  const body = original.body ?? "";
  const first = Array.isArray(original.attachments)
    ? (original.attachments[0] as { url?: string; mimeType?: string; kind?: string; filename?: string } | undefined)
    : undefined;
  const attachment: SendAttachment | null =
    first?.url && first.mimeType
      ? {
          url: first.url,
          mimeType: first.mimeType,
          filename: first.filename ?? "archivo",
          ...(first.kind === "sticker" ? { kind: "sticker" as const } : {}),
        }
      : null;

  if (windowStateOf(conv.lastInboundAt) === "open") {
    try {
      const sent = await sendMetaMessage({
        conversationId: conv.id,
        body,
        attachment,
        staffUserId: input.staffId,
        source: resendSource(original.id),
      });
      await prisma.conversationMessage.update({
        where: { id: sent.messageId },
        data: { isAutoReply: original.isAutoReply },
      });
      return { status: "sent", messageId: sent.messageId, mode: "text" };
    } catch (e) {
      return { status: "failed", error: e instanceof Error ? e.message : String(e) };
    }
  }

  // Fuera de las 24 h: solo con plantilla aprobada (y solo texto).
  let template = null;
  for (const key of RESEND_TEMPLATE_KEYS) {
    template = await approvedTemplateFor(key);
    if (template) break;
  }
  const phone = /^\d+$/.test(conv.externalThreadId) ? `+${conv.externalThreadId}` : null;
  if (template && body) {
    const recipient = (conv.contactId ? await recipientFromContact(conv.contactId) : null) ?? {
      contactId: conv.contactId,
      phoneE164: phone,
      name: conv.participantName,
      optedOut: false,
    };
    const r = await sendWhatsAppToRecipient({
      recipient,
      text: body,
      template,
      vars: { mensaje: body.replace(/\s*\n+\s*/g, " ").trim() },
      source: resendSource(original.id),
      staffId: input.staffId,
    });
    if (r.status === "sent") return { status: "sent", messageId: r.messageId, mode: "template" };
    if (r.status === "failed") return { status: "failed", error: r.error };
  }
  return {
    status: "phone",
    url: phone ? buildContactWhatsAppUrl(phone, body) : null,
    reason:
      "Pasaron más de 24 h desde su último mensaje y aún no hay plantilla aprobada: envíalo desde el WhatsApp de Dayana.",
  };
};
