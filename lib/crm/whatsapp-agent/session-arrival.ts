import { resolveGoogleAccount } from "@/agent/lib/google";
import { prisma } from "@/lib/db";
import { getTimeLabelInTz } from "@/lib/datetime/zoned-time";
import { googleUserId, meetConferenceFor, type MeetConference } from "@/lib/google/meet";
import { fireNotification } from "@/lib/notifications/platform/emit";
import { getOperationalTimezone } from "../operational-timezone";
import { getWhatsAppAiConfig, type WhatsAppAiConfig } from "../whatsapp-ai-config";
import { isFreeCallAppointment, meetCode } from "./event-title";
import type { DayanaIdentity } from "./no-show-rules";
import {
  ARRIVAL_AFTER_MIN,
  ARRIVAL_BEFORE_MIN,
  ARRIVAL_REPEAT_MIN,
  arrivalNotice,
  arrivalStep,
  inArrivalWindow,
  saysWaitingInRoom,
} from "./session-arrival-rules";

/**
 * Te esperan en la sala (reglas en `session-arrival-rules.ts`): el aviso al
 * celular de Dayana a la hora de una sesión pagada con Meet.
 *
 * - `sweepSessionArrivals`: el reloj (cada minuto, `tick.ts`) mira en Meet las
 *   sesiones de ahora; si la persona entró y Dayana todavía no, avisa una vez.
 *   Sin Meet activado en la cuenta de Google no hace nada (el aviso de «no
 *   entró» ya le cuenta a Dayana ese error).
 * - `notifyWaitingFromChat`: la persona escribe «ya estoy en la sala», «no me
 *   deja entrar»: avisa al instante (al llegar el mensaje), también con Meet
 *   apagado. Es lo único que dice que alguien pidió permiso para entrar.
 */

type Deps = {
  conference?: (meetUrl: string, since: Date) => Promise<MeetConference | null>;
  dayana?: DayanaIdentity;
};
let testDeps: Deps | null = null;
export const setArrivalDepsForTests = (deps: Deps | null) => {
  testDeps = deps;
};

type Appt = {
  id: string;
  startsAt: Date;
  name: string | null;
  phone: string | null;
  conversationId: string | null;
};

/** Cómo la reconoce Dayana: lo que ella escribió en el calendario, el chat o el número. */
const whoOf = async (appt: Appt): Promise<string> => {
  if (appt.name?.trim()) return appt.name.trim().replace(/\b\p{Ll}/gu, (c) => c.toUpperCase());
  if (appt.conversationId) {
    const conv = await prisma.conversation.findUnique({
      where: { id: appt.conversationId },
      select: { participantName: true, contact: { select: { firstName: true, lastName: true } } },
    });
    const contact = [conv?.contact?.firstName, conv?.contact?.lastName].filter(Boolean).join(" ").trim();
    if (contact || conv?.participantName?.trim()) return contact || conv!.participantName!.trim();
  }
  return appt.phone ? `+${appt.phone}` : "Tu clienta o cliente";
};

const notify = async (appt: Appt, notice: { title: string; body: string }) => {
  fireNotification({
    eventType: "WHATSAPP_SESSION_WAITING",
    title: notice.title,
    body: notice.body,
    href: appt.conversationId ? `/admin/whatsapp?conversation=${appt.conversationId}` : "/admin/whatsapp/agenda",
    entityType: "CalendarAppointment",
    entityId: appt.id,
    staff: "ALL",
  });
};

/** Las sesiones con Meet (no la llamada gratis) que están en su hora. */
const sessionsNow = async (now: Date, where: { conversationId?: string; arrivalNotifiedAt?: null } = {}) => {
  const rows = await prisma.calendarAppointment.findMany({
    where: {
      status: "active",
      meetUrl: { not: null },
      startsAt: {
        gte: new Date(now.getTime() - ARRIVAL_AFTER_MIN * 60_000),
        lte: new Date(now.getTime() + ARRIVAL_BEFORE_MIN * 60_000),
      },
      ...where,
    },
    orderBy: { startsAt: "asc" },
    take: 10,
  });
  return rows.filter((a) => meetCode(a.meetUrl) && !isFreeCallAppointment(a) && inArrivalWindow(a.startsAt, now));
};

export type ArrivalSweepResult = { checked: number; notified: number; dayanaIn: number; error?: string };

export const sweepSessionArrivals = async (config: WhatsAppAiConfig, now = new Date()): Promise<ArrivalSweepResult> => {
  const result: ArrivalSweepResult = { checked: 0, notified: 0, dayanaIn: 0 };
  if (!config.sessionArrival.enabled) return result;
  const sessions = await sessionsNow(now, { arrivalNotifiedAt: null });
  if (sessions.length === 0) return result;

  let conference = testDeps?.conference;
  let dayana = testDeps?.dayana;
  if (!conference || !dayana) {
    try {
      const { account, token } = await resolveGoogleAccount("MEET", config.booking.accountId || undefined);
      const me = await googleUserId(token);
      dayana = { id: me.id, name: me.name ?? account.displayName ?? null };
      conference = (url, since) => meetConferenceFor(token, meetCode(url)!, since);
    } catch (e) {
      result.error = e instanceof Error ? e.message : String(e);
      return result;
    }
  }
  const tz = await getOperationalTimezone();

  for (const appt of sessions) {
    result.checked++;
    let meeting: MeetConference | null;
    try {
      meeting = await conference(appt.meetUrl!, new Date(appt.startsAt.getTime() - 60 * 60_000));
    } catch (e) {
      result.error = e instanceof Error ? e.message : String(e);
      continue;
    }
    const step = arrivalStep(meeting, dayana!);
    if (step.kind === "nobody") continue;
    // Se reclama antes de avisar: suena una sola vez.
    const claimed = await prisma.calendarAppointment.updateMany({
      where: { id: appt.id, arrivalNotifiedAt: null },
      data: { arrivalNotifiedAt: now, arrivalSource: step.kind === "notify" ? "meet" : "dayana_in" },
    });
    if (claimed.count === 0) continue;
    if (step.kind === "dayana_in") {
      result.dayanaIn++;
      continue;
    }
    result.notified++;
    await notify(appt, arrivalNotice({ who: await whoOf(appt), hour: getTimeLabelInTz(appt.startsAt, tz), source: "meet", meetName: step.meetName }));
  }
  return result;
};

/**
 * Un mensaje que acaba de llegar: si dice que está esperando en la sala y
 * tiene una sesión con Meet ahora, Dayana recibe el aviso. Un segundo «sigo
 * esperando» vuelve a sonar pasados unos minutos (aunque Dayana ya esté en la
 * reunión: puede no haber visto la solicitud para entrar).
 */
export const notifyWaitingFromChat = async (input: { conversationId: string; text: string | null; sentAt?: Date; now?: Date }): Promise<boolean> => {
  const now = input.now ?? new Date();
  if (!saysWaitingInRoom(input.text)) return false;
  // Un mensaje viejo que llega tarde no es que esté esperando ahora.
  if (input.sentAt && now.getTime() - input.sentAt.getTime() > 10 * 60_000) return false;
  const config = await getWhatsAppAiConfig();
  if (!config.sessionArrival.enabled) return false;
  const [appt] = await sessionsNow(now, { conversationId: input.conversationId });
  if (!appt) return false;
  const repeatBefore = new Date(now.getTime() - ARRIVAL_REPEAT_MIN * 60_000);
  const claimed = await prisma.calendarAppointment.updateMany({
    where: {
      id: appt.id,
      OR: [{ arrivalNotifiedAt: null }, { arrivalNotifiedAt: { lt: repeatBefore } }, { arrivalSource: "dayana_in" }],
    },
    data: { arrivalNotifiedAt: now, arrivalSource: "chat" },
  });
  if (claimed.count === 0) return false;
  const tz = await getOperationalTimezone();
  await notify(appt, arrivalNotice({ who: await whoOf(appt), hour: getTimeLabelInTz(appt.startsAt, tz), source: "chat", quote: input.text }));
  return true;
};
