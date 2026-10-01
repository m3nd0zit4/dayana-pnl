import type { FreeWebinar } from "@prisma/client";
import { prisma } from "@/lib/db";
import { emitPlatformNotification } from "@/lib/notifications/platform/emit";
import { recordFreeEventActivity } from "./free-event-activity";
import { freeEventAcceptsReminders } from "./free-event-rules";
import { findCurrentFreeEventRow } from "./free-webinar";
import { getOperationalTimezone } from "./operational-timezone";
import { getSiteSetting, setSiteSetting } from "./site-settings";
import {
  eventReminderText,
  eventReminderVars,
  greetingName,
  reminderZone,
  waReminderDue,
  type EventWaPass,
} from "./event-reminder-text";
import { countPendingWaReminderRecipients, waReminderFlag, WHATSAPPABLE_CONTACT } from "./webinar-registrations";
import { recipientFromContact, sendWhatsAppToRecipient } from "./whatsapp-outbound";
import { approvedTemplateFor, type WaTemplate } from "./whatsapp-templates";

/**
 * Recordatorios del evento gratuito por WhatsApp: 24 h y 1 h antes, a cada
 * inscrita con número. Mismo patrón que `sendDueReminders` de las citas:
 *
 * - Se reclama la fila (sello con `updateMany … where sello = null`) antes de
 *   enviar, así que el cron, el botón manual y un reintento nunca mandan dos.
 * - Si no sale, el sello SE QUEDA y el motivo va a `waReminderError`. A
 *   diferencia del correo no se reintenta solo: una plantilla se cobra, y un
 *   fallo repetido cada 10 minutos sería dinero tirado. «Reintentar WA» lo
 *   decide Dayana.
 * - Texto libre (gratis) si la persona escribió en las últimas 24 h; si no, la
 *   plantilla aprobada `evento_gratis_recordatorio`.
 */

export const EVENT_WA_TEMPLATE_KEY = "evento_gratis_recordatorio";
/** Interruptor de Dayana. Sin fila = encendido. */
export const EVENT_WA_REMINDERS_SETTING = "free_event_wa_reminders";

/** Envíos simultáneos: cada uno son varias consultas y una llamada a WhatsApp. */
const CONCURRENCY = 3;

export type EventWaStopReason =
  | "no_event"
  | "inactive"
  | "ended"
  | "no_meet_url"
  | "no_schedule"
  | "disabled"
  | "outside_window";

export type EventWaResult = {
  sent: number;
  /** Se intentó y WhatsApp lo rechazó. */
  failed: number;
  /** No se pudo intentar (sin plantilla aprobada, sin número, baja). */
  skipped: number;
  /** Las que siguen esperando este recordatorio al terminar. */
  remaining: number;
  /** Se acabó el presupuesto de tiempo con cola: hay que volver a llamar. */
  stoppedEarly: boolean;
  /** Por qué no se envió nada (no hay evento, ventana cerrada, apagado…). */
  reason?: EventWaStopReason;
};

export const eventWaRemindersEnabled = async (): Promise<boolean> =>
  (await getSiteSetting(EVENT_WA_REMINDERS_SETTING).catch(() => null)) !== "false";

export const setEventWaRemindersEnabled = (enabled: boolean): Promise<void> =>
  setSiteSetting(EVENT_WA_REMINDERS_SETTING, enabled ? "true" : "false");

const SKIP_MESSAGE: Record<"needs_template" | "opted_out" | "no_phone", string> = {
  needs_template:
    "No escribió en las últimas 24 h y la plantilla «evento_gratis_recordatorio» no está aprobada.",
  opted_out: "Pidió no recibir WhatsApp.",
  no_phone: "Sin número de WhatsApp válido.",
};

const ROW_SELECT = {
  id: true,
  contactId: true,
  contact: { select: { timezone: true, phoneE164: true, phoneCountryIso: true } },
} as const;

type Row = { id: string; contactId: string; contact: { timezone: string; phoneE164: string; phoneCountryIso: string | null } };

type Outcome = { outcome: "sent" | "failed" | "skipped" | "claimed_elsewhere"; error?: string };

const loadEvent = (webinarId?: string): Promise<FreeWebinar | null> =>
  webinarId ? prisma.freeWebinar.findUnique({ where: { id: webinarId } }) : findCurrentFreeEventRow();

const saveError = (id: string, message: string) =>
  prisma.webinarRegistration
    .update({ where: { id }, data: { waReminderError: message.slice(0, 300), waReminderErrorAt: new Date() } })
    .catch(() => undefined);

export const sendEventWhatsAppReminders = async (opts: {
  pass: EventWaPass;
  /** Sin él, el evento actual. */
  webinarId?: string;
  now?: Date;
  budgetMs?: number;
  /** Solo los envíos manuales: mandar aunque no sea su momento. */
  ignoreWindow?: boolean;
  /** Solo esa inscripción. */
  registrationId?: string;
  /** Tamaño de cada tanda. */
  limit?: number;
}): Promise<EventWaResult> => {
  const { pass, budgetMs = 90_000, ignoreWindow = false, registrationId, limit = 200 } = opts;
  const now = opts.now ?? new Date();
  const deadline = Date.now() + budgetMs;
  const result: EventWaResult = { sent: 0, failed: 0, skipped: 0, remaining: 0, stoppedEarly: false };

  const event = await loadEvent(opts.webinarId);
  if (!event) return { ...result, reason: "no_event" };
  const flag = waReminderFlag(pass);
  const pending = () => countPendingWaReminderRecipients(event.id, pass);
  const stop = async (reason: EventWaStopReason): Promise<EventWaResult> => ({
    ...result,
    remaining: await pending(),
    reason,
  });

  if (event.endedAt) return stop("ended");
  // Publicado o con inscripciones cerradas: publicar el siguiente no deja sin
  // recordatorio a quien ya se inscribió en este.
  if (!freeEventAcceptsReminders(event)) return stop("inactive");
  if (!event.startsAt) return stop("no_schedule");
  if (!event.meetUrl) return stop("no_meet_url");
  if (!(await eventWaRemindersEnabled())) return stop("disabled");
  if (!ignoreWindow && !waReminderDue(pass, event.startsAt, event.startsAtHasTime, now)) {
    return stop("outside_window");
  }

  const startsAt = event.startsAt;
  const meetUrl = event.meetUrl;
  const [opTz, template] = await Promise.all([getOperationalTimezone(), approvedTemplateFor(EVENT_WA_TEMPLATE_KEY)]);
  const errors: string[] = [];

  const deliver = async (row: Row, tpl: WaTemplate | null): Promise<Outcome> => {
    // Reclamo: si otro proceso ya lo tomó, no se manda dos veces.
    const claimed = await prisma.webinarRegistration.updateMany({
      where: { id: row.id, [flag]: null },
      data: { [flag]: new Date(), waReminderError: null, waReminderErrorAt: null },
    });
    if (claimed.count === 0) return { outcome: "claimed_elsewhere" };

    const recipient = await recipientFromContact(row.contactId);
    if (!recipient?.phoneE164) {
      const error = recipient ? SKIP_MESSAGE.no_phone : "El contacto ya no existe.";
      await saveError(row.id, error);
      return { outcome: "skipped", error };
    }
    const vars = eventReminderVars({
      headline: event.headline,
      startsAt,
      startsAtHasTime: event.startsAtHasTime,
      meetUrl,
      pass,
      opTz,
      zone: reminderZone(row.contact, opTz),
      now,
    });
    const nombre = greetingName(recipient.name);
    const r = await sendWhatsAppToRecipient({
      recipient,
      text: eventReminderText({ ...vars, nombre }),
      templateKey: EVENT_WA_TEMPLATE_KEY,
      template: tpl,
      // WhatsApp no deja un parámetro vacío: sin nombre, un saludo neutro.
      vars: { ...vars, nombre: nombre || "😊" },
      source: `evento:${event.id}:${pass}`,
      isAutoReply: true,
      clientKey: `evento:${event.id}:${pass}:${startsAt.getTime()}:${recipient.phoneE164.replace(/\D/g, "")}`,
    }).catch((e: unknown) => ({ status: "failed" as const, error: e instanceof Error ? e.message : String(e) }));

    if (r.status === "sent") return { outcome: "sent" };
    const error = r.status === "skipped" ? SKIP_MESSAGE[r.reason] : `WhatsApp no lo aceptó: ${r.error}`;
    await saveError(row.id, error);
    return { outcome: r.status === "skipped" ? "skipped" : "failed", error };
  };

  // Tandas hasta vaciar la cola o agotar el presupuesto. Cada fila reclamada
  // sale de la cola (también si falla), así que el bucle siempre termina.
  for (;;) {
    if (Date.now() >= deadline) {
      result.stoppedEarly = true;
      break;
    }
    const rows: Row[] = await prisma.webinarRegistration.findMany({
      where: {
        webinarId: event.id,
        ...(registrationId ? { id: registrationId } : {}),
        [flag]: null,
        contact: WHATSAPPABLE_CONTACT,
      },
      orderBy: { createdAt: "asc" },
      take: limit,
      select: ROW_SELECT,
    });
    if (rows.length === 0) break;

    let cursor = 0;
    const lane = async () => {
      while (cursor < rows.length) {
        // Se mira antes de tomar cada fila: los envíos en vuelo terminan, pero
        // no empieza ninguno nuevo pasado el corte.
        if (Date.now() >= deadline) {
          result.stoppedEarly = true;
          return;
        }
        const row = rows[cursor];
        cursor += 1;
        const { outcome, error } = await deliver(row, template).catch((e: unknown) => ({
          outcome: "failed" as const,
          error: e instanceof Error ? e.message : String(e),
        }));
        if (outcome === "sent") result.sent += 1;
        else if (outcome === "failed") result.failed += 1;
        else if (outcome === "skipped") result.skipped += 1;
        if (error && errors.length < 3) errors.push(error);
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, rows.length) }, lane));
    if (result.stoppedEarly || registrationId || rows.length < limit) break;
  }

  result.remaining = await pending();

  // La pasada queda en la historia del evento (las de una sola persona, no:
  // son reintentos y ya se ven en su fila).
  if (!registrationId && result.sent + result.failed + result.skipped > 0) {
    await recordFreeEventActivity({
      freeWebinarId: event.id,
      kind: pass === "24h" ? "reminder_24h_wa" : "reminder_1h_wa",
      count: result.sent,
      failed: result.failed + result.skipped || null,
      meta: ignoreWindow ? { manual: true } : null,
    });
  }

  // Un solo aviso por pasada (solo campana). Se espera en vez de dispararlo
  // suelto: quien llama es el reloj o el botón, que ya son de larga duración,
  // y fuera de una petición un aviso suelto puede perderse.
  if (result.failed + result.skipped > 0) {
    await emitPlatformNotification({
      eventType: "WHATSAPP_AI_INFO",
      title: `Recordatorio de ${pass} por WhatsApp: ${result.failed + result.skipped} sin enviar`,
      body: `${result.sent} enviados. ${[...new Set(errors)].join(" ")}`.slice(0, 300),
      href: `/admin/eventos/${event.id}?tab=inscritas`,
      entityType: "FreeWebinar",
      entityId: event.id,
      staff: "ALL",
    }).catch((e: unknown) => console.error("[recordatorios WhatsApp] aviso", e));
  }
  return result;
};
