import { NotificationDeliveryStatus } from "@prisma/client";
import {
  ensureFreeWebinar,
  formatWebinarScheduleLabel,
  type FreeWebinarPublic,
} from "@/lib/crm/free-webinar";
import {
  claimRegistrationFlag,
  findPendingLinkRecipients,
  findPendingReminderRecipients,
  releaseRegistrationFlag,
  reminderFlag,
  type ReminderKind,
  type WebinarMailRecipient,
} from "@/lib/crm/webinar-registrations";
import { dispatchAndRecord } from "@/lib/notifications/dispatch";
import { resolveNotificationsEnabled } from "@/lib/notifications/platform/resolve";
import {
  webinarMeetLinkHtml,
  webinarMeetLinkSubject,
  webinarMeetLinkText,
  webinarReminderHtml,
  webinarReminderSubject,
  webinarReminderText,
} from "@/lib/notifications/templates/webinar-emails";

/**
 * Envío del enlace de la reunión y de los dos recordatorios.
 *
 * Patrón en los tres casos: reclamar el sello → enviar → soltarlo si el envío
 * no salió. Reclamar primero es lo que evita que dos ejecuciones solapadas
 * (el evento de Inngest y el cron) manden el mismo correo dos veces.
 */

export type WebinarMailResult = {
  sent: number;
  failed: number;
  /** Se cortó por presupuesto de tiempo, no por falta de cola. */
  stoppedEarly?: boolean;
  /** `true` cuando no se tocó ninguna fila: notificaciones apagadas o sin datos. */
  skipped: boolean;
  reason?: string;
};

const noop = (reason: string): WebinarMailResult => ({
  sent: 0,
  failed: 0,
  skipped: true,
  reason,
});

/**
 * Cuántas personas atiende una pasada. A 10k registradas, mandar todo en una
 * sola ejecución agota el tiempo del step de Inngest; la cola es una condición
 * de la base de datos, así que trocearla no pierde a nadie.
 */
export const WEBINAR_MAIL_BATCH = 500;

/**
 * Envíos simultáneos dentro del lote. Secuencial son ~300 ms por correo: 10k
 * tardarían casi una hora y el recordatorio de «falta 1 hora» llegaría tarde o
 * no llegaría. Con 10 en paralelo baja a minutos, y es un techo prudente para
 * no chocar con el límite de tasa de Resend.
 */
const CONCURRENCY = 10;

/**
 * Recorre la lista con un número fijo de envíos en vuelo.
 *
 * `deadline` se comprueba antes de tomar cada destinatario, no solo entre
 * lotes: si solo se mirase entre lotes, una tanda entera podría empezar justo
 * antes del corte y pasarse del presupuesto por su duración completa — medido,
 * 30 s de exceso sobre un presupuesto de 20 s. Los envíos ya en vuelo se
 * terminan; simplemente no se empieza ninguno nuevo.
 */
const runPool = async <T>(
  items: T[],
  worker: (item: T) => Promise<"sent" | "failed">,
  deadline?: number
): Promise<{ sent: number; failed: number; stoppedEarly: boolean }> => {
  let sent = 0;
  let failed = 0;
  let cursor = 0;
  let stoppedEarly = false;

  const lane = async (): Promise<void> => {
    while (cursor < items.length) {
      if (deadline !== undefined && Date.now() >= deadline) {
        stoppedEarly = true;
        return;
      }
      const item = items[cursor];
      cursor += 1;
      const outcome = await worker(item);
      if (outcome === "sent") sent += 1;
      else failed += 1;
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, items.length) }, lane)
  );
  return { sent, failed, stoppedEarly };
};

const firstName = (r: WebinarMailRecipient): string =>
  r.contact.firstName?.trim() || "Hola";

type SendOne = {
  subject: string;
  html: string;
  text: string;
  /** Snapshot en texto plano que queda en `NotificationDelivery`. */
  body: string;
  templateKey: string;
};

const deliver = async (
  recipient: WebinarMailRecipient,
  flag: Parameters<typeof claimRegistrationFlag>[1],
  payload: SendOne
): Promise<"sent" | "failed"> => {
  const claimed = await claimRegistrationFlag(recipient.id, flag);
  if (!claimed) return "sent"; // otro proceso ya se quedó con este envío

  try {
    const { result } = await dispatchAndRecord({
      contactId: recipient.contactId,
      channel: "EMAIL",
      templateKey: payload.templateKey,
      subject: payload.subject,
      html: payload.html,
      text: payload.text,
      body: payload.body,
      // Sin campaignId a propósito: esto es 1:1. Con él, Resend añadiría
      // List-Unsubscribe y Gmail lo archivaría en Promociones.
    });
    if (result.status === NotificationDeliveryStatus.SENT) return "sent";
  } catch (e) {
    console.error(
      "[webinar-mailer] dispatch",
      e instanceof Error ? e.message : e
    );
  }

  await releaseRegistrationFlag(recipient.id, flag);
  return "failed";
};

/**
 * Guarda global. Sin esto, con las notificaciones apagadas cada envío vuelve
 * SKIPPED, se suelta el sello, y el cron reintenta la lista entera cada diez
 * minutos para siempre.
 */
const notificationsOff = async (): Promise<boolean> =>
  !(await resolveNotificationsEnabled());

export const sendPendingWebinarLinkEmails = async (
    deadline?: number
  ): Promise<WebinarMailResult> => {
    if (await notificationsOff()) return noop("notifications_disabled");

    const webinar = await ensureFreeWebinar();
    if (!webinar.meetUrl) return noop("no_meet_url");

    const recipients = await findPendingLinkRecipients(
      webinar.id,
      WEBINAR_MAIL_BATCH
    );
    if (recipients.length === 0) return noop("no_pending_recipients");

    const scheduleLabel = formatWebinarScheduleLabel(webinar);
    const { sent, failed, stoppedEarly } = await runPool(
      recipients,
      (recipient) =>
      deliver(recipient, "linkEmailSentAt", {
        templateKey: "webinar_meet_link",
        subject: webinarMeetLinkSubject(),
        html: webinarMeetLinkHtml({
          firstName: firstName(recipient),
          meetUrl: webinar.meetUrl,
          scheduleLabel,
        }),
        text: webinarMeetLinkText({
          firstName: firstName(recipient),
          meetUrl: webinar.meetUrl,
          scheduleLabel,
        }),
        body: webinarMeetLinkText({
          firstName: firstName(recipient),
          meetUrl: webinar.meetUrl,
          scheduleLabel,
        }),
      }),
      deadline
    );

    return { sent, failed, skipped: false, stoppedEarly };
  };

/**
 * Ventanas de los recordatorios. El sello por persona ya evita duplicados, así
 * que la ventana solo decide *cuándo* entra alguien a la cola:
 *
 * - 24 h: entre 2 h y 24 h antes. El suelo de 2 h existe para que quien se
 *   registra tres horas antes no reciba un «falta un día» absurdo; a esa
 *   persona la recoge el pase de 1 h.
 * - 1 h: dentro de la última hora, y solo si el webinar tiene hora real.
 *   Sin hora, `startsAt` guarda un ancla de mediodía y avisar «en una hora»
 *   sobre una hora inventada es peor que no avisar.
 */
const reminderWindowOpen = (
  webinar: FreeWebinarPublic,
  kind: ReminderKind,
  now: Date
): boolean => {
  if (!webinar.startsAt) return false;
  const msToStart = webinar.startsAt.getTime() - now.getTime();
  if (msToStart <= 0) return false;

  if (kind === "24h") {
    return msToStart > 2 * 60 * 60 * 1000 && msToStart <= 24 * 60 * 60 * 1000;
  }
  return webinar.startsAtHasTime && msToStart <= 60 * 60 * 1000;
};

export const sendPendingWebinarReminders = async (
  kind: ReminderKind,
  now: Date = new Date(),
  deadline?: number
): Promise<WebinarMailResult> => {
  if (await notificationsOff()) return noop("notifications_disabled");

  const webinar = await ensureFreeWebinar();
  if (!webinar.isActive) return noop("inactive");
  if (!reminderWindowOpen(webinar, kind, now)) return noop("outside_window");

  const recipients = await findPendingReminderRecipients(
    webinar.id,
    kind,
    WEBINAR_MAIL_BATCH
  );
  if (recipients.length === 0) return noop("no_pending_recipients");

  const scheduleLabel = formatWebinarScheduleLabel(webinar);
  const flag = reminderFlag(kind);

  const { sent, failed, stoppedEarly } = await runPool(recipients, (recipient) => {
    const vars = {
      kind,
      firstName: firstName(recipient),
      meetUrl: webinar.meetUrl,
      scheduleLabel,
    };
    return deliver(recipient, flag, {
      templateKey: `webinar_reminder_${kind}`,
      subject: webinarReminderSubject(vars),
      html: webinarReminderHtml(vars),
      text: webinarReminderText(vars),
      body: webinarReminderText(vars),
    });
  }, deadline);

  return { sent, failed, skipped: false, stoppedEarly };
};

export type WebinarMailPass = "link" | "24h" | "1h";

/**
 * Presupuesto de tiempo por invocación. Una función de Vercel se corta a los
 * 300 s, así que la pasada tiene que devolver antes SIEMPRE: medido en real,
 * 10k destinatarios tardan del orden de un cuarto de hora, muy por encima del
 * tope. Cuando se agota el presupuesto se devuelve `pending: true` y quien
 * llama encadena otra invocación; los sellos por fila hacen que retomar sea
 * exacto, sin repetir a nadie.
 */
const TIME_BUDGET_MS = 210_000;

export type WebinarDrainResult = WebinarMailResult & {
  /** Queda cola: hay que encadenar otra pasada. */
  pending: boolean;
};

/**
 * Vacía la cola en lotes hasta agotarla o hasta quedarse sin presupuesto.
 * Nunca corre indefinidamente y nunca deja trabajo perdido.
 */
export const drainWebinarMail = async (
  pass: WebinarMailPass,
  budgetMs = TIME_BUDGET_MS
): Promise<WebinarDrainResult> => {
  const deadline = Date.now() + budgetMs;
  let sent = 0;
  let failed = 0;
  let firstSkip: WebinarMailResult | null = null;

  while (Date.now() < deadline) {
    const r =
      pass === "link"
        ? await sendPendingWebinarLinkEmails(deadline)
        : await sendPendingWebinarReminders(pass, new Date(), deadline);

    if (r.skipped) {
      firstSkip ??= r;
      return { sent, failed, skipped: sent + failed === 0, reason: r.reason, pending: false };
    }
    sent += r.sent;
    failed += r.failed;
    if (r.stoppedEarly) {
      return { sent, failed, skipped: false, pending: true };
    }
    // Lote incompleto = la cola se acabó.
    if (r.sent + r.failed < WEBINAR_MAIL_BATCH) {
      return { sent, failed, skipped: false, pending: false };
    }
  }

  void firstSkip;
  return { sent, failed, skipped: false, pending: true };
};
