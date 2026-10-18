import { resolveGoogleAccount } from "@/agent/lib/google";
import { prisma } from "@/lib/db";
import { getOperationalTimezone } from "../operational-timezone";
import { meetConferenceFor, googleUserId, type MeetConference } from "@/lib/google/meet";
import { fireNotification } from "@/lib/notifications/platform/emit";
import { personFirstName } from "@/lib/person-name";
import { getTimeLabelInTz } from "@/lib/datetime/zoned-time";
import { getSiteSetting, setSiteSetting } from "../site-settings";
import { getWhatsAppAiConfig, type WhatsAppAiConfig } from "../whatsapp-ai-config";
import { recipientFromContact, sendWhatsAppToRecipient } from "../whatsapp-outbound";
import { trustedContactTimezone } from "./booking-time";
import { isFreeCallAppointment, meetCode } from "./event-title";
import { NO_SHOW_GIVE_UP_MIN, noShowStep, noShowText, type DayanaIdentity } from "./no-show-rules";

/**
 * El aviso de sesión sin asistir (reglas en `no-show-rules.ts`): las sesiones
 * pagadas con Meet y ligadas a un chat que empezaron hace `afterMin` minutos.
 * Para cada una pregunta a la API de Meet quién entró; si solo está Dayana,
 * le manda a la persona el mensaje para reagendar (una vez: la cita se reclama
 * en `no_show_state` antes de enviar) y le avisa a Dayana.
 *
 * Sin Meet activado en la cuenta de Google del calendario no hace nada.
 */

export type NoShowResult = { checked: number; sent: number; joined: number; gaveUp: number; failed: number; error?: string };

type Deps = {
  /** Para pruebas: la reunión de un enlace, sin Google. */
  conference?: (meetUrl: string, since: Date) => Promise<MeetConference | null>;
  dayana?: DayanaIdentity;
  send?: typeof sendWhatsAppToRecipient;
};
let testDeps: Deps | null = null;
export const setNoShowDepsForTests = (deps: Deps | null) => {
  testDeps = deps;
};

/** Un error de Meet se le avisa a Dayana como mucho una vez al día. */
const ERROR_NOTIFIED_KEY = "whatsapp.noshow.error_notified_at";

const notifyMeetError = async (message: string, now: Date) => {
  const last = Number((await getSiteSetting(ERROR_NOTIFIED_KEY).catch(() => null)) ?? 0);
  if (now.getTime() - last < 24 * 3600_000) return;
  await setSiteSetting(ERROR_NOTIFIED_KEY, String(now.getTime())).catch(() => undefined);
  fireNotification({
    eventType: "WHATSAPP_AI_INFO",
    title: "No pude revisar quién entró a tu sesión en Meet",
    body: `${message.slice(0, 160)} Mientras tanto no se manda el aviso de sesión sin asistir.`,
    href: "/admin/ajustes/google",
    entityType: "CalendarAppointment",
    entityId: "no-show",
    staff: "ALL",
  });
};

/**
 * Para comprobar que Google deja leer Meet con la cuenta de Dayana (Gmail): la
 * reunión de un enlace, o la de la sesión más reciente con Meet (de las
 * últimas 6 h). Solo lectura; no manda nada.
 */
export const checkMeetPresence = async (input: { meetUrl?: string | null; now?: Date }) => {
  const now = input.now ?? new Date();
  const config = await getWhatsAppAiConfig();
  const appt = input.meetUrl
    ? null
    : await prisma.calendarAppointment.findFirst({
        where: { status: "active", meetUrl: { not: null }, startsAt: { gte: new Date(now.getTime() - 6 * 3600_000), lte: now } },
        orderBy: { startsAt: "desc" },
        select: { title: true, startsAt: true, meetUrl: true },
      });
  const meetUrl = input.meetUrl ?? appt?.meetUrl ?? null;
  if (!meetCode(meetUrl)) return { ok: false as const, error: "No hay una sesión con Meet en las últimas 6 h (o el enlace no es de Meet)." };
  try {
    const { account, token } = await resolveGoogleAccount("MEET", config.booking.accountId || undefined);
    const me = await googleUserId(token);
    const since = appt ? new Date(appt.startsAt.getTime() - 60 * 60_000) : new Date(now.getTime() - 6 * 3600_000);
    const meeting = await meetConferenceFor(token, meetCode(meetUrl)!, since);
    return {
      ok: true as const,
      account: account.email,
      dayana: { id: me.id, name: me.name },
      session: appt ? { title: appt.title, startsAt: appt.startsAt } : null,
      meeting,
    };
  } catch (e) {
    return { ok: false as const, error: e instanceof Error ? e.message : String(e) };
  }
};

export const sweepSessionNoShows = async (config: WhatsAppAiConfig, now = new Date()): Promise<NoShowResult> => {
  const result: NoShowResult = { checked: 0, sent: 0, joined: 0, gaveUp: 0, failed: 0 };
  if (!config.noShow.enabled) return result;
  const afterMs = config.noShow.afterMin * 60_000;
  const due = await prisma.calendarAppointment.findMany({
    where: {
      status: "active",
      noShowState: null,
      meetUrl: { not: null },
      conversationId: { not: null },
      startsAt: {
        lte: new Date(now.getTime() - afterMs),
        gte: new Date(now.getTime() - afterMs - (NO_SHOW_GIVE_UP_MIN + 30) * 60_000),
      },
    },
    orderBy: { startsAt: "asc" },
    take: 10,
  });
  // La llamada gratis va por WhatsApp; una cita sin Meet no es de aquí.
  const sessions = due.filter((a) => meetCode(a.meetUrl) && !isFreeCallAppointment(a));
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
      // Sin Meet activado (o sin permiso todavía): no hay aviso, y no se marca
      // ninguna cita para que salga en cuanto Meet esté.
      result.error = e instanceof Error ? e.message : String(e);
      return result;
    }
  }
  const send = testDeps?.send ?? sendWhatsAppToRecipient;
  const dayanaTz = await getOperationalTimezone();

  for (const appt of sessions) {
    result.checked++;
    let meeting: MeetConference | null;
    try {
      // La reunión de esta sesión: la que empezó desde una hora antes.
      meeting = await conference(appt.meetUrl!, new Date(appt.startsAt.getTime() - 60 * 60_000));
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      result.error = message;
      result.failed++;
      await prisma.calendarAppointment.updateMany({ where: { id: appt.id, noShowState: null }, data: { noShowState: "error", noShowAt: now } });
      await notifyMeetError(message, now);
      continue;
    }
    const decided = noShowStep({ startsAt: appt.startsAt, now, afterMin: config.noShow.afterMin, conference: meeting, dayana: dayana! });
    if (decided.kind === "wait") continue;
    if (decided.kind === "joined" || decided.kind === "give_up") {
      await prisma.calendarAppointment.updateMany({
        where: { id: appt.id, noShowState: null },
        data: { noShowState: decided.kind === "joined" ? "joined" : "dayana_absent", noShowAt: now },
      });
      if (decided.kind === "joined") result.joined++;
      else result.gaveUp++;
      continue;
    }

    // Se reclama antes de enviar: sale una sola vez.
    const claimed = await prisma.calendarAppointment.updateMany({
      where: { id: appt.id, noShowState: null },
      data: { noShowState: "sent", noShowAt: now },
    });
    if (claimed.count === 0) continue;
    const contact = appt.contactId
      ? await prisma.contact.findUnique({ where: { id: appt.contactId }, select: { timezone: true, countryIso: true, phoneCountryIso: true } })
      : null;
    const dossier = await prisma.whatsAppDossier.findUnique({ where: { conversationId: appt.conversationId! }, select: { timezone: true } });
    const zone = dossier?.timezone ?? trustedContactTimezone(contact) ?? dayanaTz;
    const recipient = (appt.contactId ? await recipientFromContact(appt.contactId) : null) ?? {
      contactId: appt.contactId,
      phoneE164: `+${appt.phone}`,
      name: appt.name,
      optedOut: false,
    };
    const name = recipient.name ?? appt.name;
    const text = noShowText({ template: config.noShow.message, name, startsAt: appt.startsAt, timeZone: zone });
    const r = await send({
      recipient,
      text,
      templateKey: "sesion_no_asistio",
      vars: { nombre: personFirstName(name) ?? "", hora: getTimeLabelInTz(appt.startsAt, zone) },
      source: `sin_asistir:${appt.eventId}`,
      isAutoReply: true,
      clientKey: `noshow:${appt.eventId}:${appt.startsAt.getTime()}`,
    }).catch((e: unknown) => ({ status: "failed" as const, error: e instanceof Error ? e.message : String(e) }));

    const who = personFirstName(name) ?? appt.name ?? `+${appt.phone}`;
    const hour = getTimeLabelInTz(appt.startsAt, dayanaTz);
    if (r.status === "sent") {
      result.sent++;
      fireNotification({
        eventType: "WHATSAPP_AI_INFO",
        title: `${who} no entró a su sesión de las ${hour}`,
        body: "Le mandé el mensaje para reagendar. Tú le confirmas la nueva hora.",
        href: "/admin/whatsapp/agenda",
        entityType: "CalendarAppointment",
        entityId: appt.id,
        staff: "ALL",
      });
      continue;
    }
    result.failed++;
    const reason =
      r.status === "skipped"
        ? r.reason === "needs_template"
          ? "Fuera de las 24 h: falta aprobar la plantilla «Sesión: no se conectó» (WhatsApp → Plantillas)."
          : r.reason === "opted_out"
            ? "Pidió no recibir WhatsApp."
            : "Sin número válido."
        : r.error;
    await prisma.calendarAppointment.update({ where: { id: appt.id }, data: { noShowState: "failed" } });
    fireNotification({
      eventType: "WHATSAPP_AI_INFO",
      title: `${who} no entró a su sesión de las ${hour}`,
      body: `No le pude mandar el mensaje para reagendar: ${reason.slice(0, 160)}`,
      href: "/admin/whatsapp/agenda",
      entityType: "CalendarAppointment",
      entityId: appt.id,
      staff: "ALL",
    });
  }
  return result;
};
