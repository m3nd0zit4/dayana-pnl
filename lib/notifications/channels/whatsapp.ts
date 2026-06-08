import { isDryRun } from "../config";

export type SendWhatsAppInput = {
  toE164: string;
  body: string;
};

export type SendWhatsAppResult = {
  providerId: string;
  messageId?: string;
};

const toWhatsAppRecipient = (e164: string): string =>
  e164.replace(/\D/g, "");

export const sendWhatsAppTemplateMessage = async (
  input: SendWhatsAppInput
): Promise<SendWhatsAppResult> => {
  if (isDryRun()) {
    console.info("[notifications:dry-run] whatsapp", {
      to: input.toE164,
      preview: input.body.slice(0, 80),
    });
    return { providerId: "dry-run" };
  }

  const token = process.env.WHATSAPP_API_TOKEN?.trim();
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID?.trim();

  if (!token || !phoneNumberId) {
    throw new Error(
      "WhatsApp API no configurada: WHATSAPP_API_TOKEN y WHATSAPP_PHONE_NUMBER_ID"
    );
  }

  const res = await fetch(
    `https://graph.facebook.com/v21.0/${phoneNumberId}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: toWhatsAppRecipient(input.toE164),
        type: "text",
        text: { preview_url: true, body: input.body },
      }),
    }
  );

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`WhatsApp API error: ${res.status} ${err}`);
  }

  const data = (await res.json()) as {
    messages?: { id?: string }[];
  };
  return {
    providerId: "whatsapp-cloud",
    messageId: data.messages?.[0]?.id,
  };
};
