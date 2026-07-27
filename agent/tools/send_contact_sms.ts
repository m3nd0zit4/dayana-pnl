import { defineTool } from "eve/tools";
import { always } from "eve/tools/approval";
import { z } from "zod";
import { getContactById } from "@/lib/crm/contacts";
import { templateVariableNames } from "@/lib/crm/quick-message-templates";
import {
  isDryRun,
  isNotificationsEnabled,
  smsProviderReady,
} from "@/lib/notifications/config";
import { dispatchAndRecord } from "@/lib/notifications/dispatch";
import { SMS_REQUIRED_ENV } from "@/lib/notifications/health";
// Misma regla que usa el reparto de notificaciones para decidir si un teléfono
// es marcable: se comparte para que no se separen con el tiempo.
import { isDialableE164 } from "@/lib/notifications/platform/email";
import { emitPlatformNotification } from "@/lib/notifications/platform/emit";
import { requireWriteStaff, auditAgentWrite } from "@/agent/lib/guard";

/** "A, B y C" — leerlo como lista en español ahorra una ida y vuelta. */
const spanishList = (items: string[]): string =>
  items.length <= 1
    ? (items[0] ?? "")
    : `${items.slice(0, -1).join(", ")} y ${items[items.length - 1]}`;

const missingTwilioEnv = (): string[] =>
  SMS_REQUIRED_ENV.filter((name) => !process.env[name]?.trim());

export default defineTool({
  description:
    "Send one short freeform SMS to a single contact via Twilio. Use it only when the message is urgent or genuinely short (a reminder, a confirmation) — for anything longer prefer send_contact_email, since SMS is billed per 160-character segment. It sends to ONE contact, refuses contacts who opted out of SMS or have no real phone number on file, and refuses outright when the SMS channel has no credentials — in that case relay the missing environment variables to the operator instead of retrying. The result includes a `dryRun` flag: when it is true nothing actually left the server, so tell the operator the send was only simulated instead of claiming it was delivered.",
  inputSchema: z.object({
    contactId: z.string().min(1),
    body: z
      .string()
      .trim()
      .min(5)
      .max(320)
      .describe(
        "Texto plano, sin formato. Los SMS largos se cobran por segmento."
      ),
  }),
  approval: always(),
  async execute({ contactId, body }, ctx) {
    requireWriteStaff(ctx);

    // El cuerpo pasa por renderQuickMessage, que solo sustituye las variables
    // que recibe — y aquí no se le pasa ninguna. Un «{{first_name}}» llegaría
    // literal al teléfono del cliente, así que se rechaza antes de enviar.
    const placeholders = templateVariableNames(body);
    if (placeholders.length > 0) {
      throw new Error(
        `El texto lleva variables sin rellenar (${placeholders
          .map((name) => `{{${name}}}`)
          .join(", ")}). Escribe el dato real: aquí no hay plantilla que las sustituya.`
      );
    }

    const contact = await getContactById(contactId);
    if (!contact) throw new Error("Contacto no encontrado.");

    // Los contactos creados por checkout o registro con Google llevan un
    // teléfono marcador («+pending», «+google:…»): existe la columna pero no
    // es un número al que se pueda escribir.
    if (!isDialableE164(contact.phoneE164)) {
      throw new Error(
        "Ese contacto no tiene un teléfono real registrado, así que no puedo enviarle un SMS. " +
          "Si tiene correo, usa send_contact_email."
      );
    }

    // Dispatch devolvería SKIPPED en silencio; fallar aquí le da al modelo un
    // motivo que puede repetirle a la operadora en vez de cantar un envío que
    // nunca ocurrió.
    if (!contact.notifySms) {
      throw new Error(
        "Ese contacto desactivó las notificaciones por SMS. No puedo escribirle por ese canal."
      );
    }

    if (!isNotificationsEnabled()) {
      throw new Error(
        "Los envíos están desactivados (NOTIFICATIONS_ENABLED). Actívalo en /admin/ajustes/integraciones."
      );
    }

    // El canal existe pero está inerte hasta que aparezcan las credenciales.
    // Nombrar las variables exactas es la única salida útil: quien lea esto en
    // el chat puede resolverlo sin abrir el código.
    if (!smsProviderReady()) {
      const missing = missingTwilioEnv();
      throw new Error(
        `El canal SMS no está configurado. Falta ${spanishList(
          missing.length > 0 ? missing : SMS_REQUIRED_ENV
        )} — se activan en /admin/ajustes.`
      );
    }

    const { delivery, result } = await dispatchAndRecord({
      contactId,
      channel: "SMS",
      body,
    });

    await auditAgentWrite(ctx, {
      action: "SEND_SMS",
      entityType: "NotificationDelivery",
      entityId: delivery.id,
      changes: {
        contactId,
        chars: body.length,
        status: result.status,
      },
    });

    // Awaited y no `fireNotification`: las tools de eve corren fuera del ámbito
    // de una petición, donde `after()` no tiene dónde colgarse.
    await emitPlatformNotification({
      eventType: "AGENT_ACTION_EXECUTED",
      title: "El asistente envió un SMS",
      body: `${contact.displayName ?? contact.firstName} — ${body.slice(0, 60)} (${result.status})`,
      href: `/admin/contacts/${contactId}`,
      entityType: "NotificationDelivery",
      entityId: delivery.id,
      staff: "ALL",
    });

    return {
      deliveryId: delivery.id,
      status: result.status,
      recipient: result.recipient,
      dryRun: isDryRun(),
      note:
        result.status === "SKIPPED"
          ? "Se registró pero NO se envió — revisa la configuración."
          : undefined,
    };
  },
});
