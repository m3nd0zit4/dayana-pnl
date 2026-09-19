import {
  EnrollmentStatus,
  NotificationDeliveryStatus,
  WorkshopEditionStatus,
  type Prisma,
} from "@prisma/client";
import { prisma } from "@/lib/db";
import { dispatchAndRecord } from "@/lib/notifications/dispatch";
import { resolveNotificationsEnabled } from "@/lib/notifications/platform/resolve";
import {
  workshopReminderHtml,
  workshopReminderSubject,
  workshopReminderText,
  type WorkshopReminderPass,
} from "@/lib/notifications/templates/workshop-reminder";

export type { WorkshopReminderPass } from "@/lib/notifications/templates/workshop-reminder";

/**
 * Recordatorios de taller PAGADO — 24 h y 1 h antes de que arranque la
 * edición. Mismo patrón que `lib/crm/webinar-mailer.ts` (aprobado por Dayana
 * como «sí, como el del webinar»): reclamar el sello por fila antes de
 * enviar, y soltarlo si el envío falla para que el siguiente cron reintente.
 *
 * A diferencia del webinar, aquí no hace falta el fan-out por lotes ni el
 * presupuesto de tiempo: una edición de taller tiene decenas de matrículas,
 * no miles, así que un solo paso agota la cola sin acercarse al tope de una
 * función de Vercel.
 */

const HOUR_MS = 60 * 60 * 1000;

/**
 * Ventana de cada pase, calcada de `reminderWindowOpen` en
 * `webinar-mailer.ts`:
 *
 * - 24 h: entre 2 h y 24 h antes. El suelo de 2 h existe para que quien se
 *   inscribe tres horas antes no reciba un «es mañana» absurdo — a esa
 *   persona la recoge el pase de 1 h.
 * - 1 h: dentro de la última hora.
 *
 * Pura y exportada para poder probar los límites sin tocar la base de datos.
 */
export const reminderDue = (
  pass: WorkshopReminderPass,
  startsAt: Date,
  now: Date = new Date()
): boolean => {
  const msToStart = startsAt.getTime() - now.getTime();
  if (msToStart <= 0) return false;
  if (pass === "24h") {
    return msToStart > 2 * HOUR_MS && msToStart <= 24 * HOUR_MS;
  }
  return msToStart <= HOUR_MS;
};

/** Límites de `startsAt` para la misma ventana, usados en el `WHERE` de Prisma. */
const windowBounds = (
  pass: WorkshopReminderPass,
  now: Date
): { gt: Date; lte: Date } =>
  pass === "24h"
    ? { gt: new Date(now.getTime() + 2 * HOUR_MS), lte: new Date(now.getTime() + 24 * HOUR_MS) }
    : { gt: now, lte: new Date(now.getTime() + HOUR_MS) };

type ReminderFlag = "workshopReminder24hSentAt" | "workshopReminder1hSentAt";

const reminderFlag = (pass: WorkshopReminderPass): ReminderFlag =>
  pass === "24h" ? "workshopReminder24hSentAt" : "workshopReminder1hSentAt";

/**
 * Solo entran a la cola quienes pueden recibir correo — igual que en el
 * webinar, se filtra en el `where` y nunca sellando, para que un contacto al
 * que se le añade el correo más tarde siga siendo alcanzable.
 */
const EMAILABLE_CONTACT = {
  email: { not: null },
  notifyEmail: true,
} satisfies Prisma.ContactWhereInput;

const RECIPIENT_SELECT = {
  id: true,
  contactId: true,
  contact: {
    select: { id: true, firstName: true, lastName: true, email: true },
  },
  workshopEdition: {
    select: {
      id: true,
      slug: true,
      title: true,
      startsAt: true,
      timezone: true,
      meetingUrl: true,
    },
  },
} satisfies Prisma.EnrollmentSelect;

export type WorkshopReminderRecipient = Prisma.EnrollmentGetPayload<{
  select: typeof RECIPIENT_SELECT;
}>;

/** Cuántas matrículas atiende una pasada. De sobra para el volumen de un taller. */
export const WORKSHOP_REMINDER_BATCH = 200;

export const findPendingWorkshopReminderRecipients = async (
  pass: WorkshopReminderPass,
  now: Date,
  take = WORKSHOP_REMINDER_BATCH
): Promise<WorkshopReminderRecipient[]> => {
  const { gt, lte } = windowBounds(pass, now);
  return prisma.enrollment.findMany({
    where: {
      workshopEditionId: { not: null },
      status: { in: [EnrollmentStatus.ACTIVE, EnrollmentStatus.COMPLETED] },
      [reminderFlag(pass)]: null,
      contact: EMAILABLE_CONTACT,
      workshopEdition: {
        // Nunca DRAFT (no publicada) ni COMPLETED (ya pasó): igual que el
        // webinar no manda recordatorios de una edición ya cerrada del todo.
        status: { in: [WorkshopEditionStatus.OPEN, WorkshopEditionStatus.CLOSED] },
        startsAt: { gt, lte },
      },
    },
    orderBy: { createdAt: "asc" },
    take,
    select: RECIPIENT_SELECT,
  });
};

/**
 * Sella la columna solo si seguía vacía. `count === 1` significa «este
 * proceso se quedó con el envío»; un cron repetido no puede ganar dos veces.
 */
export const claimEnrollmentReminderFlag = async (
  enrollmentId: string,
  flag: ReminderFlag
): Promise<boolean> => {
  const { count } = await prisma.enrollment.updateMany({
    where: { id: enrollmentId, [flag]: null },
    data: { [flag]: new Date() },
  });
  return count === 1;
};

/**
 * El envío falló: se suelta el sello para que el siguiente barrido reintente.
 * A diferencia de `WebinarRegistration`, `Enrollment` no tiene columna de
 * último error — el detalle del fallo queda igualmente en
 * `NotificationDelivery` (vía `dispatchAndRecord`) y en el log del proceso.
 */
export const releaseEnrollmentReminderFlag = async (
  enrollmentId: string,
  flag: ReminderFlag
): Promise<void> => {
  await prisma.enrollment.updateMany({
    where: { id: enrollmentId },
    data: { [flag]: null },
  });
};

const firstName = (r: WorkshopReminderRecipient): string =>
  r.contact.firstName?.trim() || "Hola";

export type DeliverOutcome = {
  outcome: "sent" | "failed" | "claimed_elsewhere";
  errorMessage?: string | null;
};

const deliverOne = async (
  recipient: WorkshopReminderRecipient,
  pass: WorkshopReminderPass
): Promise<DeliverOutcome> => {
  const flag = reminderFlag(pass);
  const claimed = await claimEnrollmentReminderFlag(recipient.id, flag);
  // Otro proceso ya se quedó con este envío: no es un fallo.
  if (!claimed) return { outcome: "claimed_elsewhere" };

  const edition = recipient.workshopEdition;
  // No debería pasar — la consulta ya exige `workshopEditionId` y
  // `startsAt` dentro de la ventana — pero sin esto un `startsAt` nulo
  // rompería el envío en vez de simplemente saltarlo.
  if (!edition || !edition.startsAt) {
    await releaseEnrollmentReminderFlag(recipient.id, flag);
    return { outcome: "failed", errorMessage: "missing_edition_or_starts_at" };
  }

  const vars = {
    firstName: firstName(recipient),
    title: edition.title,
    slug: edition.slug,
    startsAt: edition.startsAt,
    timezone: edition.timezone,
    // Solo llega aquí porque `recipient` viene de una matrícula ACTIVA/COMPLETED
    // — es decir, alguien que pagó — así que no hace falta comprobar acceso
    // otra vez antes de meterlo en el recordatorio.
    meetingUrl: edition.meetingUrl,
    pass,
  };

  let errorMessage: string | null = null;
  try {
    const { result } = await dispatchAndRecord({
      contactId: recipient.contactId,
      channel: "EMAIL",
      templateKey: `workshop_reminder_${pass}`,
      subject: workshopReminderSubject(vars),
      html: workshopReminderHtml(vars),
      text: workshopReminderText(vars),
      body: workshopReminderText(vars),
      // Sin campaignId a propósito: es 1:1, igual que los correos del webinar.
    });
    if (result.status === NotificationDeliveryStatus.SENT) {
      return { outcome: "sent" };
    }
    errorMessage = result.errorMessage ?? `estado ${result.status}`;
  } catch (e) {
    errorMessage = e instanceof Error ? e.message : String(e);
  }

  console.error(
    `[workshop-reminders] fallo al enviar ${pass} a enrollment ${recipient.id}:`,
    errorMessage
  );
  await releaseEnrollmentReminderFlag(recipient.id, flag);
  return { outcome: "failed", errorMessage };
};

export type WorkshopReminderResult = {
  sent: number;
  failed: number;
  /** `true` cuando no se tocó ninguna fila: notificaciones apagadas o sin cola. */
  skipped: boolean;
  reason?: string;
};

const noop = (reason: string): WorkshopReminderResult => ({
  sent: 0,
  failed: 0,
  skipped: true,
  reason,
});

/**
 * Vacía la cola de un pase. Guarda global de notificaciones apagadas +
 * consulta de pendientes + reclamar/enviar/soltar por fila — sin bucle de
 * presupuesto de tiempo porque el volumen de un taller no lo necesita (ver
 * comentario de cabecera).
 *
 * Nunca lanza por un correo individual que falle: `deliverOne` atrapa el
 * error, lo registra con el prefijo `[workshop-reminders]` y suelta el
 * sello para el siguiente barrido.
 */
export const drainWorkshopReminders = async (
  pass: WorkshopReminderPass,
  now: Date = new Date(),
  limit = WORKSHOP_REMINDER_BATCH
): Promise<WorkshopReminderResult> => {
  if (!(await resolveNotificationsEnabled())) return noop("notifications_disabled");

  const recipients = await findPendingWorkshopReminderRecipients(pass, now, limit);
  if (recipients.length === 0) return noop("no_pending_recipients");

  let sent = 0;
  let failed = 0;

  for (const recipient of recipients) {
    const startsAt = recipient.workshopEdition?.startsAt;
    // Defensa extra con la misma función pura que se prueba por separado:
    // si la ventana ya se cerró entre la consulta y este punto, se salta.
    if (!startsAt || !reminderDue(pass, startsAt, now)) continue;

    try {
      const { outcome } = await deliverOne(recipient, pass);
      if (outcome === "failed") failed += 1;
      else sent += 1;
    } catch (e) {
      // No debería llegar aquí — deliverOne ya atrapa sus propios errores —
      // pero un fallo aquí NUNCA debe tumbar el resto de la cola.
      console.error(
        `[workshop-reminders] error inesperado con enrollment ${recipient.id}:`,
        e instanceof Error ? e.message : String(e)
      );
      failed += 1;
    }
  }

  return { sent, failed, skipped: false };
};
