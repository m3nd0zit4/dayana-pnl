import type { Conversation } from "@prisma/client";
import { prisma } from "@/lib/db";
import { resolveDryRun } from "@/lib/notifications/platform/resolve";
import {
  graphPost,
  MetaApiError,
  whatsAppCredentials,
  type MetaCredentials,
} from "./client";
import {
  CREDENTIAL_EXPIRED_MESSAGE,
  reportPageCredentialFailure,
  resolvePageCredentials,
} from "./credentials";
import { resolveWindow, type WindowState } from "./window";

/**
 * Envío saliente unificado para WhatsApp, Messenger e Instagram.
 *
 * Instagram y Messenger salen por el **mismo** endpoint de la Página: al estar
 * la cuenta de IG vinculada a la Página, un solo token y una sola llamada
 * cubren los dos canales. Solo cambia el id del destinatario.
 */

export type SendInput = {
  conversationId: string;
  body: string;
  staffUserId?: string | null;
  /** Plantilla aprobada, obligatoria en WhatsApp fuera de la ventana de 24 h. */
  template?: {
    name: string;
    language: string;
    /** Parámetros posicionales del cuerpo de la plantilla. */
    variables?: string[];
  } | null;
};

export type SendResult = {
  messageId: string;
  externalMessageId: string | null;
  dryRun: boolean;
};

export class MetaSendError extends Error {}
export class MetaWindowError extends MetaSendError {
  readonly window: WindowState;
  constructor(message: string, window: WindowState) {
    super(message);
    this.name = "MetaWindowError";
    this.window = window;
  }
}

const digitsOnly = (value: string): string => value.replace(/\D/g, "");

type GraphMessageResponse = {
  messages?: { id?: string }[];
  message_id?: string;
};

const readMessageId = (res: GraphMessageResponse): string | null =>
  res.messages?.[0]?.id ?? res.message_id ?? null;

const sendWhatsApp = async (
  conversation: Conversation,
  input: SendInput,
  window: WindowState,
  credentials: MetaCredentials
): Promise<string | null> => {
  const to = digitsOnly(conversation.externalThreadId);

  // Fuera de ventana WhatsApp rechaza el texto libre. Antes esto se enviaba
  // igual y fallaba en silencio; ahora se exige plantilla de forma explícita.
  if (!window.isOpen) {
    if (!input.template) {
      throw new MetaWindowError(
        "Fuera de la ventana de 24 h de WhatsApp: hace falta una plantilla aprobada.",
        window
      );
    }

    const res = await graphPost<GraphMessageResponse>(
      `${credentials.accountId}/messages`,
      {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to,
        type: "template",
        template: {
          name: input.template.name,
          language: { code: input.template.language },
          ...(input.template.variables?.length
            ? {
                components: [
                  {
                    type: "body",
                    parameters: input.template.variables.map((text) => ({
                      type: "text",
                      text,
                    })),
                  },
                ],
              }
            : {}),
        },
      },
      credentials
    );
    return readMessageId(res);
  }

  const res = await graphPost<GraphMessageResponse>(
    `${credentials.accountId}/messages`,
    {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to,
      type: "text",
      text: { preview_url: true, body: input.body },
    },
    credentials
  );
  return readMessageId(res);
};

const sendViaPage = async (
  conversation: Conversation,
  input: SendInput,
  window: WindowState,
  credentials: MetaCredentials
): Promise<string | null> => {
  if (window.requirement === "closed") {
    throw new MetaWindowError(
      "Pasaron más de 7 días desde el último mensaje: Meta no permite responder.",
      window
    );
  }

  const res = await graphPost<GraphMessageResponse>(
    `${credentials.accountId}/messages`,
    {
      recipient: { id: conversation.externalThreadId },
      message: { text: input.body },
      messaging_type:
        window.requirement === "human_agent" ? "MESSAGE_TAG" : "RESPONSE",
      // Amplía la ventana a 7 días; requiere la función Human Agent aprobada.
      ...(window.requirement === "human_agent" ? { tag: "HUMAN_AGENT" } : {}),
    },
    credentials
  );
  return readMessageId(res);
};

/**
 * Envía un mensaje y lo registra en el hilo.
 *
 * La fila de `ConversationMessage` se escribe siempre — también cuando Meta
 * rechaza el envío — con estado FAILED y el motivo. Un mensaje que desaparece
 * sin rastro es peor que uno marcado como fallido.
 */
export const sendMetaMessage = async (
  input: SendInput
): Promise<SendResult> => {
  const conversation = await prisma.conversation.findUnique({
    where: { id: input.conversationId },
  });
  if (!conversation) throw new MetaSendError("La conversación no existe.");

  const window = resolveWindow(conversation.channel, conversation.lastInboundAt);

  const pageCredentialsUsed =
    conversation.channel === "WHATSAPP" ? null : await resolvePageCredentials();
  const credentials =
    conversation.channel === "WHATSAPP"
      ? whatsAppCredentials()
      : pageCredentialsUsed;

  if (!credentials) {
    throw new MetaSendError(
      conversation.channel === "WHATSAPP"
        ? "WhatsApp no está configurado (WHATSAPP_API_TOKEN y WHATSAPP_PHONE_NUMBER_ID)."
        : "La Página de Meta no está configurada (META_PAGE_ID y META_PAGE_ACCESS_TOKEN)."
    );
  }

  const dryRun = await resolveDryRun();
  let externalMessageId: string | null = null;
  let failedReason: string | null = null;

  if (!dryRun) {
    try {
      externalMessageId =
        conversation.channel === "WHATSAPP"
          ? await sendWhatsApp(conversation, input, window, credentials)
          : await sendViaPage(conversation, input, window, credentials);
    } catch (e) {
      // La ventana se valida antes de llegar a la red: es un error del operador,
      // no un fallo de envío, así que no deja una fila fallida en el hilo.
      if (e instanceof MetaWindowError) throw e;

      // Token de Página muerto: se marca la conexión como caída para que la
      // pantalla de Conexiones ofrezca reconectar, y el motivo que queda en el
      // hilo dice qué hacer en vez de un "código 190" que nadie puede accionar.
      // Solo aplica al token de Página guardado en la base: el de WhatsApp vive
      // en el entorno y no hay nada que marcar como caído.
      const storedAccountId =
        conversation.channel !== "WHATSAPP" &&
        pageCredentialsUsed?.source === "db"
          ? pageCredentialsUsed.socialAccountId
          : null;

      if (e instanceof MetaApiError && e.isAuthError && storedAccountId) {
        await reportPageCredentialFailure(e, storedAccountId);
        failedReason = CREDENTIAL_EXPIRED_MESSAGE;
      } else {
        failedReason =
          e instanceof MetaApiError
            ? `${e.message}${e.code ? ` (código ${e.code})` : ""}`
            : e instanceof Error
              ? e.message
              : "Error desconocido";
      }
    }
  }

  const message = await prisma.conversationMessage.create({
    data: {
      conversationId: conversation.id,
      direction: "OUTBOUND",
      status: failedReason ? "FAILED" : "SENT",
      externalMessageId,
      body: input.body,
      staffUserId: input.staffUserId ?? null,
      failedReason,
    },
    select: { id: true },
  });

  if (!failedReason) {
    await prisma.conversation.update({
      where: { id: conversation.id },
      data: {
        lastMessageAt: new Date(),
        status: "PENDING",
        unreadCount: 0,
        // Responder consume el borrador: dejarlo puesto invita a enviarlo dos veces.
        draftBody: null,
        draftSource: null,
        draftUpdatedAt: null,
      },
    });
  }

  if (failedReason) throw new MetaSendError(failedReason);

  return { messageId: message.id, externalMessageId, dryRun };
};
