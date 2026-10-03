import { EnrollmentStatus, type Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  runWaReminderPass,
  WA_REMINDER_ROW_SELECT,
  type EventWaResult,
  type WaReminderSpec,
  type WaSkipReason,
} from "./event-whatsapp-reminders";
import { workshopReminderVars, workshopWaReminderText, type EventWaPass } from "./event-reminder-text";
import { getSiteSetting, setSiteSetting } from "./site-settings";
import { recordWorkshopActivity } from "./workshop-activity";
import { workshopAcceptsReminders, workshopStartsAtHasTime } from "./workshop-lifecycle-rules";
import { WHATSAPPABLE_CONTACT } from "./webinar-registrations";

/**
 * Recordatorios por WhatsApp de un taller, 24 h y 1 h antes, con el enlace de
 * la reunión: el mismo envío que el de los eventos (`runWaReminderPass`), a
 * quien pagó la edición. El sello vive en la matrícula.
 */

export const WORKSHOP_WA_TEMPLATE_KEY = "taller_recordatorio";
/** Interruptor de Dayana, aparte del de los eventos. Sin fila = encendido. */
export const WORKSHOP_WA_REMINDERS_SETTING = "workshop_wa_reminders";

export const workshopWaRemindersEnabled = async (): Promise<boolean> =>
  (await getSiteSetting(WORKSHOP_WA_REMINDERS_SETTING).catch(() => null)) !== "false";

export const setWorkshopWaRemindersEnabled = (enabled: boolean): Promise<void> =>
  setSiteSetting(WORKSHOP_WA_REMINDERS_SETTING, enabled ? "true" : "false");

export const workshopWaFlag = (pass: EventWaPass) =>
  pass === "24h" ? ("workshopReminder24hWaSentAt" as const) : ("workshopReminder1hWaSentAt" as const);

/** El error de cada pasada va aparte: un 1 h que sale no tapa un 24 h que falló. */
export const workshopWaErrorColumn = (pass: EventWaPass) =>
  pass === "24h" ? ("workshopWaReminderError" as const) : ("workshopWaReminder1hError" as const);

/** Pagaron esta edición (la misma regla que los correos). */
export const PAID_ENROLLMENT = {
  in: [EnrollmentStatus.ACTIVE, EnrollmentStatus.COMPLETED],
} satisfies Prisma.EnumEnrollmentStatusFilter;

const pendingWhere = (workshopEditionId: string, pass: EventWaPass) =>
  ({
    workshopEditionId,
    status: PAID_ENROLLMENT,
    [workshopWaFlag(pass)]: null,
    contact: WHATSAPPABLE_CONTACT,
  }) satisfies Prisma.EnrollmentWhereInput;

export const countPendingWorkshopWaReminders = (workshopEditionId: string, pass: EventWaPass) =>
  prisma.enrollment.count({ where: pendingWhere(workshopEditionId, pass) });

/** Para la vista previa del envío manual (cuántas gratis, cuántas con plantilla). */
export const listPendingWorkshopWaContactIds = async (
  workshopEditionId: string,
  pass: EventWaPass,
  take = 2000
): Promise<string[]> => [
  ...new Set(
    (
      await prisma.enrollment.findMany({
        where: pendingWhere(workshopEditionId, pass),
        select: { contactId: true },
        take,
      })
    ).map((r) => r.contactId)
  ),
];

/** Reintento a mano: se suelta el sello de esa pasada y su error. */
export const releaseWorkshopWaReminder = (enrollmentId: string, pass: EventWaPass) =>
  prisma.enrollment.updateMany({
    where: { id: enrollmentId },
    data: { [workshopWaFlag(pass)]: null, [workshopWaErrorColumn(pass)]: null },
  });

/**
 * Para la clave de envío: cuándo volvieron los recordatorios a la cola por
 * última vez (otra fecha u otro enlace). Así salen otra vez aunque el enlace o
 * la fecha vuelvan a ser los de antes (A → B → A); con la clave de antes se
 * darían por enviados. Sin vuelta a la cola, la clave no cambia y nadie recibe
 * dos.
 */
const lastRequeueKey = async (workshopEditionId: string): Promise<string | undefined> => {
  const last = await prisma.workshopEditionActivity.findFirst({
    where: { workshopEditionId, kind: { in: ["date_changed", "meeting_link_changed"] } },
    orderBy: { at: "desc" },
    select: { at: true },
  });
  return last ? last.at.getTime().toString(36) : undefined;
};

const SKIP_MESSAGE: Record<WaSkipReason, string> = {
  needs_template: "No escribió en las últimas 24 h y la plantilla «taller_recordatorio» no está aprobada.",
  opted_out: "Pidió no recibir WhatsApp.",
  no_phone: "Sin número de WhatsApp válido.",
};

export const sendWorkshopWhatsAppReminders = async (opts: {
  pass: EventWaPass;
  editionId: string;
  now?: Date;
  budgetMs?: number;
  /** Solo los envíos manuales: mandar aunque no sea su momento. */
  ignoreWindow?: boolean;
  /** Solo esa matrícula. */
  enrollmentId?: string;
  limit?: number;
}): Promise<EventWaResult> => {
  const { pass, editionId } = opts;
  const [edition, requeueKey] = await Promise.all([
    prisma.workshopEdition.findUnique({ where: { id: editionId } }),
    lastRequeueKey(editionId),
  ]);
  const flag = workshopWaFlag(pass);
  const hasTime = edition ? workshopStartsAtHasTime(edition) : false;

  const spec: WaReminderSpec = {
    target: edition
      ? {
          id: edition.id,
          startsAt: edition.startsAt,
          startsAtHasTime: hasTime,
          meetUrl: edition.meetingUrl,
          ended: Boolean(edition.endedAt) || edition.status === "COMPLETED",
          live: workshopAcceptsReminders(edition),
        }
      : null,
    pass,
    templateKey: WORKSHOP_WA_TEMPLATE_KEY,
    sourcePrefix: "taller",
    keySuffix: requeueKey,
    enabled: workshopWaRemindersEnabled,
    findRows: (take, rowId) =>
      prisma.enrollment.findMany({
        where: { ...pendingWhere(editionId, pass), ...(rowId ? { id: rowId } : {}) },
        orderBy: { createdAt: "asc" },
        take,
        select: WA_REMINDER_ROW_SELECT,
      }),
    claim: async (rowId) =>
      (
        await prisma.enrollment.updateMany({
          where: { id: rowId, [flag]: null },
          data: { [flag]: new Date(), [workshopWaErrorColumn(pass)]: null },
        })
      ).count > 0,
    saveError: (rowId, message) =>
      prisma.enrollment
        .update({
          where: { id: rowId },
          data: { [workshopWaErrorColumn(pass)]: message.slice(0, 300), workshopWaReminderErrorAt: new Date() },
        })
        .catch(() => undefined),
    pending: () => countPendingWorkshopWaReminders(editionId, pass),
    vars: ({ zone, opTz, now }) =>
      workshopReminderVars({
        title: edition?.title ?? "",
        startsAt: edition?.startsAt ?? now,
        startsAtHasTime: hasTime,
        meetingUrl: edition?.meetingUrl ?? "",
        pass,
        opTz,
        zone,
        now,
      }),
    text: workshopWaReminderText,
    skipMessages: SKIP_MESSAGE,
    recordPass: (result, manual) =>
      recordWorkshopActivity({
        workshopEditionId: editionId,
        kind: pass === "24h" ? "reminder_24h_wa" : "reminder_1h_wa",
        count: result.sent,
        failed: result.failed + result.skipped || null,
        meta: manual ? { manual: true } : null,
      }),
    notify: {
      href: `/admin/workshops/${encodeURIComponent(edition?.slug ?? "")}?tab=inscritas`,
      entityType: "WorkshopEdition",
    },
  };

  return runWaReminderPass(spec, {
    now: opts.now,
    budgetMs: opts.budgetMs,
    ignoreWindow: opts.ignoreWindow,
    rowId: opts.enrollmentId,
    limit: opts.limit,
  });
};
