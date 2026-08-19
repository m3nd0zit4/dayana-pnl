import {
  smsFromNumber,
  smsStatusCallbackUrl,
  type SmsSenderKind,
} from "../config";
import { resolveDryRun } from "../platform/resolve";

export type SendSmsInput = {
  toE164: string;
  body: string;
  /** Qué remitente usar. Por defecto transaccional — ver smsFromNumber(). */
  kind?: SmsSenderKind;
};

export type SendSmsResult = {
  providerId: string;
  messageId?: string;
};

export const sendSms = async (input: SendSmsInput): Promise<SendSmsResult> => {
  const kind: SmsSenderKind = input.kind ?? "transactional";
  const from = smsFromNumber(kind);

  if (await resolveDryRun()) {
    // `from` va en el log a propósito: es la única forma de comprobar qué
    // remitente se eligió sin gastar un mensaje real.
    console.info("[notifications:dry-run] sms", {
      to: input.toE164,
      from,
      kind,
      preview: input.body.slice(0, 80),
    });
    return { providerId: "dry-run" };
  }

  const sid = process.env.TWILIO_ACCOUNT_SID?.trim();
  const token = process.env.TWILIO_AUTH_TOKEN?.trim();

  if (!sid || !token || !from) {
    throw new Error(
      "SMS no configurado: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER"
    );
  }

  const auth = Buffer.from(`${sid}:${token}`).toString("base64");
  const params = new URLSearchParams({
    To: input.toE164,
    From: from,
    Body: input.body,
  });

  // Sin esto un 2xx del API se registra como SENT y nadie confirma nunca que
  // el mensaje llegó al teléfono. Ver app/api/webhooks/twilio/status.
  const statusCallback = smsStatusCallbackUrl();
  if (statusCallback) params.set("StatusCallback", statusCallback);

  const res = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
    }
  );

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Twilio error: ${res.status} ${err}`);
  }

  const data = (await res.json()) as { sid?: string };
  return { providerId: "twilio", messageId: data.sid };
};
