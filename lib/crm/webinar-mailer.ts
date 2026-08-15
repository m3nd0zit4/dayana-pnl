import { NotificationDeliveryStatus } from "@prisma/client";
import {
  ensureFreeWebinar,
  formatWebinarScheduleLabel,
  type FreeWebinarPublic,
} from "@/lib/crm/free-webinar";
import {
  claimRegistrationFlag,
  clearRegistrationSendError,
  findRegistrationForResend,
  findPendingLinkRecipients,
  findPendingReminderRecipients,
  releaseRegistrationFlag,
  reminderFlag,
  resetLinkEmails,
  resetOneReminder,
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
 * no llegaría.
 */
const CONCURRENCY = 6;

/**
 * Resend corta a 10 peticiones por segundo. Con 10 envíos en vuelo y latencias
 * por debajo del segundo se pasa: en el primer envío real a 120 personas
 * devolvió ocho 429 seguidos. No basta con bajar la concurrencia — lo que hay
 * que limitar es el ritmo, así que cada envío espera su turno en una ranura de
 * 125 ms (8/s, con margen bajo el tope).
 */
const MIN_SEND_INTERVAL_MS = 125;

let nextSlot = 0;

/** Reserva la siguiente ranura y espera hasta que llegue. */
const takeSendSlot = async (): Promise<void> => {
  const now = Date.now();
  const slot = Math.max(now, nextSlot);
  nextSlot = slot + MIN_SEND_INTERVAL_MS;
  const wait = slot - now;
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
};

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
  worker: (item: T) => Promise<DeliverOutcome>,
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
      await takeSendSlot();
      const { outcome } = await worker(item);
      if (outcome === "failed") failed += 1;
      else sent += 1;
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

export type DeliverOutcome = {
  outcome: "sent" | "failed" | "claimed_elsewhere";
  errorMessage?: string | null;
};

const deliver = async (
  recipient: WebinarMailRecipient,
  flag: Parameters<typeof claimRegistrationFlag>[1],
  payload: SendOne
): Promise<DeliverOutcome> => {
  const claimed = await claimRegistrationFlag(recipient.id, flag);
  // Otro proceso ya se quedó con este envío: no es un fallo, pero conviene
  // distinguirlo para que un reenvío manual no diga «enviado» sin haber hecho
  // nada.
  if (!claimed) return { outcome: "claimed_elsewhere" };

  let errorMessage: string | null = null;
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
    if (result.status === NotificationDeliveryStatus.SENT) {
      await clearRegistrationSendError(recipient.id);
      return { outcome: "sent" };
    }
    errorMessage = result.errorMessage ?? `estado ${result.status}`;
  } catch (e) {
    errorMessage = e instanceof Error ? e.message : String(e);
    console.error("[webinar-mailer] dispatch", errorMessage);
  }

  await releaseRegistrationFlag(recipient.id, flag, errorMessage);
  return { outcome: "failed", errorMessage };
};


export type WebinarMailPass = "link" | "24h" | "1h";

/**
 * Una sola definicion de que dice cada correo. La comparten el barrido masivo
 * y el reenvio individual: si vivieran por separado, un reenvio podria mandar
 * un texto distinto del que recibio todo el mundo.
 */
export const buildWebinarMailPayload = (
  webinar: FreeWebinarPublic,
  recipient: WebinarMailRecipient,
  pass: WebinarMailPass
): SendOne => {
  const vars = {
    firstName: firstName(recipient),
    meetUrl: webinar.meetUrl,
    // El material viaja con el enlace: quien recibe uno recibe el otro.
    materialFileName: webinar.materialFileName,
    scheduleLabel: formatWebinarScheduleLabel(webinar),
  };
  if (pass === "link") {
    return {
      templateKey: "webinar_meet_link",
      subject: webinarMeetLinkSubject(),
      html: webinarMeetLinkHtml(vars),
      text: webinarMeetLinkText(vars),
      body: webinarMeetLinkText(vars),
    };
  }
  const reminderVars = { ...vars, kind: pass };
  return {
    templateKey: `webinar_reminder_${pass}`,
    subject: webinarReminderSubject(reminderVars),
    html: webinarReminderHtml(reminderVars),
    text: webinarReminderText(reminderVars),
    body: webinarReminderText(reminderVars),
  };
};

export const passFlag = (pass: WebinarMailPass) =>
  pass === "link" ? ("linkEmailSentAt" as const) : reminderFlag(pass);

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

    // Payload por el constructor compartido: si se construyera aqui aparte,
    // el barrido masivo y el reenvio individual podrian divergir — que es
    // justo como el material se habria quedado fuera de estos correos.
    const { sent, failed, stoppedEarly } = await runPool(
      recipients,
      (recipient) =>
        deliver(
          recipient,
          "linkEmailSentAt",
          buildWebinarMailPayload(webinar, recipient, "link")
        ),
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

  const flag = reminderFlag(kind);

  const { sent, failed, stoppedEarly } = await runPool(
    recipients,
    (recipient) =>
      deliver(recipient, flag, buildWebinarMailPayload(webinar, recipient, kind)),
    deadline
  );

  return { sent, failed, skipped: false, stoppedEarly };
};

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

/* -------------------------------------------------------------------------
 * Reenvios manuales
 *
 * Los barridos automaticos ya reintentan solos: un fallo suelta el sello y el
 * siguiente cron lo recoge. Esto es para cuando hace falta forzarlo — alguien
 * borro el correo, las notificaciones estuvieron apagadas, o el contenido
 * estaba mal y hay que mandarlo otra vez.
 *
 * A diferencia de los barridos, el reenvio individual NO respeta la ventana
 * del recordatorio: reenviar a mano el aviso de 24 h fuera de su ventana es
 * una decision deliberada del operador, no un error.
 * ---------------------------------------------------------------------- */

export type ResendOneResult =
  | { ok: true; outcome: "sent" | "claimed_elsewhere" }
  | { ok: false; reason: "not_found" | "wrong_webinar" | "unreachable" | "no_meet_url" | "notifications_disabled"; errorMessage?: string | null }
  | { ok: false; reason: "failed"; errorMessage?: string | null };

/** Reenvia un correo concreto a una persona concreta. */
export const resendWebinarMailToOne = async (
  registrationId: string,
  pass: WebinarMailPass
): Promise<ResendOneResult> => {
  if (await notificationsOff()) {
    return { ok: false, reason: "notifications_disabled" };
  }

  const registration = await findRegistrationForResend(registrationId);
  if (!registration) return { ok: false, reason: "not_found" };

  const webinar = await ensureFreeWebinar();
  // Solo la edicion viva. Una archivada conserva su meetUrl historico, y
  // reenviarlo mandaria un enlace muerto a una lista ya cerrada.
  if (registration.webinarId !== webinar.id) {
    return { ok: false, reason: "wrong_webinar" };
  }
  if (pass === "link" && !webinar.meetUrl) {
    return { ok: false, reason: "no_meet_url" };
  }
  // Sin correo o dada de baja: no se sella nada, para que siga siendo
  // alcanzable si mas adelante anade un correo.
  if (!registration.contact.email) {
    return { ok: false, reason: "unreachable" };
  }

  const flag = passFlag(pass);
  // Se limpia el sello para que `deliver` pueda reclamarlo de nuevo.
  await releaseRegistrationFlag(registration.id, flag);

  const { outcome, errorMessage } = await deliver(
    registration,
    flag,
    buildWebinarMailPayload(webinar, registration, pass)
  );

  if (outcome === "failed") return { ok: false, reason: "failed", errorMessage };
  return { ok: true, outcome };
};

/**
 * Devuelve a la cola a TODAS las registradas de la edicion viva y la vacia.
 * Es la version deliberada de lo que ya hace cambiar el enlace de la reunion.
 */
export const resendWebinarMailToAll = async (
  pass: WebinarMailPass
): Promise<WebinarMailResult & { requeued: number }> => {
  const webinar = await ensureFreeWebinar();
  const requeued =
    pass === "link"
      ? await resetLinkEmails(webinar.id)
      : await resetOneReminder(webinar.id, pass);

  const result = await drainWebinarMail(pass);
  return { ...result, requeued };
};
