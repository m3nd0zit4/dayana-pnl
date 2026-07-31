import { graphPost, whatsAppCredentials } from "@/lib/meta/client";
import { resolveDryRun } from "../platform/resolve";

export type SendWhatsAppInput = {
  toE164: string;
  body: string;
};

export type SendWhatsAppResult = {
  providerId: string;
  messageId?: string;
};

const toWhatsAppRecipient = (e164: string): string => e164.replace(/\D/g, "");

/**
 * Envío suelto por WhatsApp Cloud API, para el camino de notificaciones.
 *
 * OJO con el nombre: manda **texto libre**, no una plantilla, así que solo
 * funciona dentro de la ventana de 24 h. Se conserva tal cual porque los
 * llamantes de `lib/notifications/` dependen de esta firma; para responder en
 * un hilo de la bandeja usa `sendMetaMessage` de `lib/meta/send.ts`, que sí
 * resuelve la ventana y cae a plantilla cuando toca.
 */
export const sendWhatsAppTemplateMessage = async (
  input: SendWhatsAppInput
): Promise<SendWhatsAppResult> => {
  if (await resolveDryRun()) {
    console.info("[notifications:dry-run] whatsapp", {
      to: input.toE164,
      preview: input.body.slice(0, 80),
    });
    return { providerId: "dry-run" };
  }

  const credentials = whatsAppCredentials();
  if (!credentials) {
    throw new Error(
      "WhatsApp API no configurada: WHATSAPP_API_TOKEN y WHATSAPP_PHONE_NUMBER_ID"
    );
  }

  const data = await graphPost<{ messages?: { id?: string }[] }>(
    `${credentials.accountId}/messages`,
    {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: toWhatsAppRecipient(input.toE164),
      type: "text",
      text: { preview_url: true, body: input.body },
    },
    credentials
  );

  return {
    providerId: "whatsapp-cloud",
    messageId: data.messages?.[0]?.id,
  };
};
