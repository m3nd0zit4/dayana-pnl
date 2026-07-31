import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { sendEmail } from "../channels/email";
import { sendSms } from "../channels/sms";
import { siteUrl, smsProviderReady } from "../config";
import {
  escapeHtml,
  wrapEmailHtml,
} from "../templates/email-layout";
import { NOTIFICATION_CATALOG } from "./catalog";
import { resolveNotificationsEnabled } from "./resolve";

/** Tope de caracteres del SMS: dos segmentos GSM-7. Más allá se cobra de más. */
const SMS_MAX_CHARS = 300;

/**
 * Un E.164 real es "+" seguido solo de dígitos.
 *
 * Los contactos creados por checkout, Google o registro por correo llevan un
 * teléfono marcador de posición ("+pending", "+google:uuid", "+signup:uuid").
 * La regla "solo dígitos" los descarta a todos y también a cualquier prefijo
 * marcador que se invente en el futuro, sin tener que mantener una lista.
 */
export const isDialableE164 = (phone: string | null | undefined): boolean =>
  typeof phone === "string" && /^\+[1-9]\d{6,14}$/.test(phone);

/**
 * Un SMS no es un correo recortado: sin asunto, sin HTML y sin enlace largo.
 * Se manda el título y, si cabe, la primera línea del cuerpo.
 */
const composeSmsBody = (title: string, body: string | null): string => {
  const firstLine = body?.split(/\n/).map((l) => l.trim()).find(Boolean);
  const full = firstLine ? `${title}: ${firstLine}` : title;
  const flat = full.replace(/\s+/g, " ").trim();
  return flat.length > SMS_MAX_CHARS
    ? `${flat.slice(0, SMS_MAX_CHARS - 1).trimEnd()}…`
    : flat;
};

const paragraphsToHtml = (body: string): string =>
  body
    .split(/\n{2,}/)
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .map(
      (chunk) =>
        `<p style="margin:0 0 14px;">${escapeHtml(chunk).replace(/\n/g, "<br />")}</p>`
    )
    .join("");

/** Convierte un `href` interno en una URL absoluta para el correo. */
const absoluteHref = (href: string | null): string | undefined => {
  if (!href) return undefined;
  if (/^https?:\/\//i.test(href)) return href;
  return `${siteUrl().replace(/\/$/, "")}${href.startsWith("/") ? "" : "/"}${href}`;
};

/**
 * Reparte una notificación ya creada por los canales salientes: correo
 * siempre, y SMS cuando Twilio está configurado y el contacto lo acepta.
 *
 * El nombre sigue diciendo "Emails" porque lo llaman `emit.ts` y una función
 * de Inngest; renombrarlo cambiaría dos sitios sin ganar nada. Léelo como
 * "reparte esta notificación hacia afuera".
 *
 * Idempotente: solo toma destinatarios con `emailedAt` nulo y lo estampa al
 * terminar, así un reintento no vuelve a enviar. Registra cada intento en
 * `NotificationDelivery` — que ahora acepta `staffUserId` sin contacto, y por
 * eso los avisos al equipo ya no tienen que saltarse la tubería.
 *
 * IDEMPOTENCIA DEL SMS — decisión consciente: `emailedAt` pasa a significar
 * "se completó el reparto saliente de este destinatario", no "se le mandó un
 * correo". Los dos canales se intentan en la MISMA pasada y el sello se pone
 * una sola vez al final, así que un reintento no duplica ni el correo ni el
 * SMS. El costo es que no se pueden reintentar por separado: si el correo sale
 * y el SMS falla, el reintento no vuelve a intentar el SMS (queda la fila
 * FAILED en `NotificationDelivery` como rastro). Lo limpio sería una columna
 * `smsedAt` en `NotificationRecipient`; no se añade aquí porque exige migración.
 */
export const deliverNotificationEmails = async (notificationId: string) => {
  if (!(await resolveNotificationsEnabled())) return { sent: 0, skipped: 0, smsSent: 0 };

  const smsReady = smsProviderReady();

  const notification = await prisma.platformNotification.findUnique({
    where: { id: notificationId },
    select: {
      id: true,
      eventType: true,
      title: true,
      body: true,
      href: true,
      recipients: {
        where: { emailedAt: null },
        select: {
          id: true,
          staffUserId: true,
          contactId: true,
          staffUser: {
            select: { email: true, displayName: true, notifyEmail: true },
          },
          contact: {
            select: {
              email: true,
              firstName: true,
              notifyEmail: true,
              phoneE164: true,
              notifySms: true,
            },
          },
        },
      },
    },
  });
  if (!notification || notification.recipients.length === 0) {
    return { sent: 0, skipped: 0, smsSent: 0 };
  }

  const entry = NOTIFICATION_CATALOG[notification.eventType];

  // Preferencias por evento del staff, en una sola consulta.
  const staffIds = notification.recipients
    .map((recipient) => recipient.staffUserId)
    .filter((id): id is string => Boolean(id));
  const prefRows = staffIds.length
    ? await prisma.staffNotificationPreference.findMany({
        where: {
          staffUserId: { in: staffIds },
          eventType: notification.eventType,
        },
        select: { staffUserId: true, email: true },
      })
    : [];
  const prefByStaff = new Map(
    prefRows.map((row) => [row.staffUserId, row.email])
  );

  const html = wrapEmailHtml({
    preheader: notification.body ?? notification.title,
    eyebrow: entry.group,
    title: notification.title,
    bodyHtml: notification.body
      ? paragraphsToHtml(notification.body)
      : `<p style="margin:0 0 14px;">${escapeHtml(notification.title)}</p>`,
    ctaPrimary: absoluteHref(notification.href)
      ? { label: "Abrir en el panel", href: absoluteHref(notification.href)! }
      : undefined,
  });
  const text = [notification.title, notification.body ?? ""]
    .filter(Boolean)
    .join("\n\n");

  const smsText = composeSmsBody(notification.title, notification.body);

  /**
   * Buzón de avisos del equipo, configurable en /admin/ajustes/notificaciones.
   *
   * Existe porque el correo de una cuenta de staff es además su usuario de
   * acceso, y no siempre es un buzón que reciba: el dominio puede estar
   * configurado solo para enviar, y entonces cada aviso rebota en silencio
   * (Resend acepta el envío y el rebote llega después, así que la entrega queda
   * registrada como SENT). Con esto se redirige el correo del equipo sin tocar
   * con qué credenciales entra nadie.
   *
   * Solo afecta al correo hacia el staff; los miembros siguen recibiendo en su
   * propia dirección.
   */
  const { getNotificationSiteConfig } = await import("./site-config");
  const alertInbox = (await getNotificationSiteConfig()).staffAlertInbox;

  let sent = 0;
  let skipped = 0;
  let smsSent = 0;

  for (const recipient of notification.recipients) {
    const isStaff = Boolean(recipient.staffUserId);
    const to = isStaff
      ? alertInbox ?? recipient.staffUser?.email
      : recipient.contact?.email;

    // El interruptor maestro se combina con AND sobre la preferencia por evento.
    const wants = isStaff
      ? (recipient.staffUser?.notifyEmail ?? false) &&
        (prefByStaff.get(recipient.staffUserId!) ?? entry.defaultEmail)
      : (recipient.contact?.notifyEmail ?? false) && entry.defaultEmail;

    /**
     * SMS solo para miembros: `StaffUser` no tiene columna de teléfono, así
     * que el equipo no es destinatario posible de este canal.
     *
     * `entry.defaultEmail` se reutiliza como "este evento merece salir de la
     * app": el catálogo no tiene una preferencia por evento para SMS, y sin
     * ese filtro cada aviso del feed se convertiría en un mensaje de texto
     * cobrado. Es deliberadamente conservador — un evento que no manda correo
     * tampoco manda SMS.
     */
    const smsTo =
      !isStaff &&
      smsReady &&
      entry.defaultEmail &&
      (recipient.contact?.notifySms ?? false) &&
      isDialableE164(recipient.contact?.phoneE164)
        ? recipient.contact!.phoneE164
        : null;

    if ((!to || !wants) && !smsTo) {
      // Se estampa igual: no queremos reevaluarlo en cada pasada.
      await prisma.notificationRecipient.update({
        where: { id: recipient.id },
        data: { emailedAt: new Date() },
      });
      skipped += 1;
      continue;
    }

    // Las escrituras se acumulan y se confirman junto con el sello, para que
    // "se repartió" y "quedó registrado" no puedan divergir.
    const writes: Prisma.PrismaPromise<unknown>[] = [];

    if (to && wants) {
      let status: "SENT" | "FAILED" = "SENT";
      let providerId: string | null = null;
      let errorMessage: string | null = null;

      try {
        const result = await sendEmail({
          to,
          subject: notification.title,
          html,
          text,
        });
        providerId = result.messageId
          ? `${result.providerId}:${result.messageId}`
          : result.providerId;
        sent += 1;
      } catch (e) {
        status = "FAILED";
        errorMessage = e instanceof Error ? e.message : String(e);
      }

      writes.push(
        prisma.notificationDelivery.create({
          data: {
            contactId: recipient.contactId,
            staffUserId: recipient.staffUserId,
            platformNotificationId: notification.id,
            channel: "EMAIL",
            status,
            templateKey: notification.eventType,
            subject: notification.title,
            bodySnapshot: text,
            recipient: to,
            providerId,
            errorMessage,
            sentAt: status === "SENT" ? new Date() : null,
          },
        })
      );
    }

    if (smsTo) {
      let status: "SENT" | "FAILED" = "SENT";
      let providerId: string | null = null;
      let errorMessage: string | null = null;

      try {
        const result = await sendSms({ toE164: smsTo, body: smsText });
        providerId = result.messageId
          ? `${result.providerId}:${result.messageId}`
          : result.providerId;
        smsSent += 1;
      } catch (e) {
        status = "FAILED";
        errorMessage = e instanceof Error ? e.message : String(e);
      }

      writes.push(
        prisma.notificationDelivery.create({
          data: {
            contactId: recipient.contactId,
            platformNotificationId: notification.id,
            channel: "SMS",
            status,
            templateKey: notification.eventType,
            // Sin `subject`: un SMS no lo tiene, y guardar el título ahí haría
            // que el registro mintiera sobre lo que recibió la persona.
            bodySnapshot: smsText,
            recipient: smsTo,
            providerId,
            errorMessage,
            sentAt: status === "SENT" ? new Date() : null,
          },
        })
      );
    }

    writes.push(
      prisma.notificationRecipient.update({
        where: { id: recipient.id },
        data: { emailedAt: new Date() },
      })
    );

    await prisma.$transaction(writes);
  }

  return { sent, skipped, smsSent };
};
