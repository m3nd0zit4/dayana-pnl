import { Prisma } from "@prisma/client";

import { resolveGoogleAccount } from "@/agent/lib/google";
import { prisma } from "@/lib/db";
import { listEvents, patchEventText, type CalendarEvent } from "@/lib/google/calendar";
import { fireNotification } from "@/lib/notifications/platform/emit";
import { contactPhoneCandidates, isWhatsAppUserId, whatsAppDigits, whatsAppIdVariants } from "@/lib/whatsapp-contact";
import { getOperationalTimezone } from "../operational-timezone";
import { getSiteSettingBoolean } from "../site-settings";
import { getWhatsAppAiConfig, type WhatsAppAiConfig } from "../whatsapp-ai-config";
import { recipientFromContact, sendWhatsAppToRecipient, type RecipientInfo } from "../whatsapp-outbound";
import { appointmentCoversUntil, appointmentJustLinked } from "../whatsapp-pending-rules";
import { isAvailabilityBlock } from "./calendar";
import { trustedContactTimezone } from "./booking-time";
import { foldName, isFreeCallAppointment, isPackageCounter, meetCode, nameMatches, parseEventTitle, withPhone } from "./event-title";
import { freeCallReminderText, soonReminderDecision, soonReminderWindow } from "./free-call-reminder-rules";
import { resolveConversations } from "./pending";
import { getTimeLabelInTz, isValidIanaTimeZone } from "@/lib/datetime/zoned-time";
import { personFirstName } from "@/lib/person-name";
import { appointmentGreetingName } from "./chat-name";

/**
 * Las citas del Google Calendar de Dayana, ligadas a cada persona.
 *
 * - Lee el calendario (30 días atrás y 30 adelante), sin los bloques
 *   «Disponible» ni lo marcado como libre o cancelado.
 * - Liga cada cita con la persona: por el número del título, o por el nombre
 *   si hay UNA sola persona que coincide (y entonces le agrega el número al
 *   título, para que Dayana sepa quién es). Si hay dudas, le pregunta.
 * - Manda el recordatorio de WhatsApp 24 h antes, una sola vez; y a la llamada
 *   gratis, otro una hora antes («hoy a las…», `sendSoonReminders`).
 */

const DAY = 24 * 3600_000;

/**
 * Completar el número en el título del evento cambia el Google Calendar de
 * Dayana: va apagado hasta que ella lo encienda (`true`). Elegir la persona a
 * mano en Agenda sí lo completa, porque ahí lo pidió ella.
 */
export const TITLE_PATCH_KEY = "whatsapp.appointments.title_patch";
/** Recordatorios de cita 24 h antes desde el reloj. Encendidos salvo `false`. */
export const REMINDERS_ENABLED_KEY = "whatsapp.cron.reminders_enabled";

export const isTitlePatchEnabled = async (): Promise<boolean> =>
  (await getSiteSettingBoolean(TITLE_PATCH_KEY).catch(() => null)) === true;

export const areRemindersEnabled = async (): Promise<boolean> =>
  (await getSiteSettingBoolean(REMINDERS_ENABLED_KEY).catch(() => null)) !== false;

export type Candidate = { name: string; phone: string; contactId: string | null; conversationId: string | null };

const eventTime = (v: CalendarEvent["start"]): Date | null =>
  v?.dateTime ? new Date(v.dateTime) : null; // las de todo el día no son citas

/** Personas que podrían ser la del evento, por nombre (contactos y chats). */
export const findCandidatesByName = async (name: string): Promise<Candidate[]> => {
  const folded = foldName(name);
  if (!folded) return [];
  const words = folded.split(" ").filter((w) => w.length > 1);
  if (words.length === 0) return [];
  const [contacts, convs] = await Promise.all([
    prisma.contact.findMany({
      where: { AND: words.map((w) => ({ searchText: { contains: w } })) },
      select: { id: true, firstName: true, lastName: true, phoneE164: true },
      take: 20,
    }),
    prisma.conversation.findMany({
      where: {
        channel: "WHATSAPP",
        AND: words.map((w) => ({ participantName: { contains: w, mode: "insensitive" as const } })),
      },
      select: { id: true, participantName: true, externalThreadId: true, contactId: true },
      take: 20,
    }),
  ]);
  const byPhone = new Map<string, Candidate>();
  for (const c of contacts) {
    const full = [c.firstName, c.lastName].filter(Boolean).join(" ");
    if (!/^\+\d{8,15}$/.test(c.phoneE164) || !nameMatches(name, full)) continue;
    const phone = whatsAppDigits(c.phoneE164);
    byPhone.set(phone, { name: full, phone, contactId: c.id, conversationId: null });
  }
  for (const cv of convs) {
    if (!/^\d+$/.test(cv.externalThreadId) || !nameMatches(name, cv.participantName ?? "")) continue;
    const prev = byPhone.get(cv.externalThreadId);
    byPhone.set(cv.externalThreadId, {
      name: prev?.name ?? cv.participantName ?? "",
      phone: cv.externalThreadId,
      contactId: prev?.contactId ?? cv.contactId,
      conversationId: cv.id,
    });
  }
  return [...byPhone.values()];
};

/** La persona dueña de un número (contacto y chat). */
const byPhone = async (digits: string): Promise<{ contactId: string | null; conversationId: string | null }> => {
  const thread = whatsAppDigits(`+${digits}`);
  const [contact, conv] = await Promise.all([
    prisma.contact.findFirst({ where: { phoneE164: { in: contactPhoneCandidates(thread) } }, select: { id: true } }),
    prisma.conversation.findFirst({
      where: { channel: "WHATSAPP", externalThreadId: { in: [...new Set([thread, digits].flatMap(whatsAppIdVariants))] } },
      select: { id: true, contactId: true },
    }),
  ]);
  return { contactId: contact?.id ?? conv?.contactId ?? null, conversationId: conv?.id ?? null };
};

export type SyncDeps = {
  /** Para pruebas: eventos del calendario sin llamar a Google. */
  events?: CalendarEvent[];
  /** Para pruebas: qué hacer al cambiar un título. */
  patchTitle?: (eventId: string, summary: string) => Promise<void>;
  now?: Date;
};

export type SyncResult = {
  seen: number;
  linked: number;
  titled: number;
  ambiguous: number;
  cancelled: number;
  /** Chats pendientes que quedaron atendidos por una cita nueva o movida. */
  resolved: number;
  /** Chats a los que se ligó una sesión por el enlace de Meet (su estado cambia). */
  meetLinkedChats: string[];
};

/**
 * Liga al chat las sesiones sin número cuyo enlace de Meet Dayana mandó a UNA
 * sola persona en los últimos 60 días. Solo las que llevan contador de sesiones
 * («3/6», «3.6»): una clase en grupo comparte enlace con muchos y no es de nadie.
 */
const linkSessionsByMeet = async (
  eventIds: string[],
  now: Date
): Promise<{ conversationId: string; phone: string | null; contactId: string | null; startsAt: Date }[]> => {
  if (eventIds.length === 0) return [];
  const rows = await prisma.calendarAppointment.findMany({
    where: { eventId: { in: eventIds }, status: "active", conversationId: null, meetUrl: { not: null }, phone: null },
    select: { id: true, meetUrl: true, sessionsLabel: true, startsAt: true },
  });
  const byCode = new Map<string, typeof rows>();
  for (const r of rows) {
    if (!isPackageCounter(r.sessionsLabel)) continue;
    const code = meetCode(r.meetUrl);
    if (code) byCode.set(code, [...(byCode.get(code) ?? []), r]);
  }
  if (byCode.size === 0) return [];
  const since = new Date(now.getTime() - 60 * DAY);
  const hits = await prisma.$queryRaw<{ code: string; conversation_id: string; external_thread_id: string; contact_id: string | null }[]>`
    SELECT k.code, MIN(c.id) AS conversation_id, MIN(c.external_thread_id) AS external_thread_id, MIN(c.contact_id) AS contact_id
    FROM unnest(${[...byCode.keys()]}::text[]) AS k(code)
    JOIN conversation_messages m
      ON m.direction = 'OUTBOUND' AND m.sent_at > ${since} AND strpos(lower(m.body), k.code) > 0
    JOIN conversations c ON c.id = m.conversation_id AND c.channel = 'WHATSAPP'
    GROUP BY k.code
    HAVING COUNT(DISTINCT c.id) = 1`;
  const linked: { conversationId: string; phone: string | null; contactId: string | null; startsAt: Date }[] = [];
  for (const h of hits) {
    const phone = /^\d+$/.test(h.external_thread_id) ? h.external_thread_id : null;
    for (const appt of byCode.get(h.code) ?? []) {
      const done = await prisma.calendarAppointment.updateMany({
        where: { id: appt.id, conversationId: null },
        data: { conversationId: h.conversation_id, contactId: h.contact_id, phone, matchState: "meet", candidates: Prisma.DbNull },
      });
      if (done.count) linked.push({ conversationId: h.conversation_id, phone, contactId: h.contact_id, startsAt: appt.startsAt });
    }
  }
  return linked;
};

export const syncAppointments = async (deps: SyncDeps = {}): Promise<SyncResult> => {
  const now = deps.now ?? new Date();
  const startedAt = new Date();
  const result: SyncResult = { seen: 0, linked: 0, titled: 0, ambiguous: 0, cancelled: 0, resolved: 0, meetLinkedChats: [] };
  const toResolve: { conversationId: string | null; phone: string | null; contactId: string | null; until: Date }[] = [];
  let events = deps.events;
  let patchTitle = deps.patchTitle;
  let googleAccountId: string | null = null;
  if (!events) {
    const config = await getWhatsAppAiConfig();
    const { account, token } = await resolveGoogleAccount("CALENDAR", config.booking.accountId || undefined);
    googleAccountId = account.id;
    events = await listEvents(token, {
      timeMin: new Date(now.getTime() - 30 * DAY).toISOString(),
      timeMax: new Date(now.getTime() + 30 * DAY).toISOString(),
      maxResults: 250,
    });
    if (await isTitlePatchEnabled()) {
      patchTitle = async (eventId, summary) => {
        await patchEventText(token, eventId, { summary });
      };
    }
  }

  const seenIds: string[] = [];
  const newlyAmbiguous: string[] = [];
  for (const ev of events) {
    if (ev.status === "cancelled" || ev.transparency === "transparent" || isAvailabilityBlock(ev.summary)) continue;
    const start = eventTime(ev.start);
    const end = eventTime(ev.end);
    if (!start || !end) continue;
    result.seen++;
    seenIds.push(ev.id);
    const title = (ev.summary ?? "").trim();
    const parsed = parseEventTitle(title);
    const existing = await prisma.calendarAppointment.findUnique({ where: { eventId: ev.id } });
    const booking = await prisma.whatsAppBooking.findFirst({
      where: { calendarEventId: ev.id },
      select: { contactId: true, conversationId: true, phone: true },
    });

    let phone = parsed.phone ? whatsAppDigits(`+${parsed.phone}`) : (booking?.phone ?? null);
    let contactId: string | null = booking?.contactId ?? null;
    let conversationId: string | null = booking?.conversationId ?? null;
    let matchState = existing?.matchState === "confirmed" ? "confirmed" : "unmatched";
    let candidates: Candidate[] | null = null;
    let newTitle = title;

    if (existing?.matchState === "confirmed" && existing.phone) {
      phone = existing.phone;
      contactId = existing.contactId;
      conversationId = existing.conversationId;
    } else if (phone) {
      const who = await byPhone(phone);
      contactId = contactId ?? who.contactId;
      conversationId = conversationId ?? who.conversationId;
      matchState = parsed.phone ? "phone" : "auto";
    } else if (existing?.matchState === "meet" && existing.conversationId) {
      // Ligada por el enlace de Meet que Dayana le mandó (abajo): se queda así.
      phone = existing.phone;
      contactId = existing.contactId;
      conversationId = existing.conversationId;
      matchState = "meet";
    } else if (parsed.name) {
      const found = await findCandidatesByName(parsed.name);
      if (found.length === 1) {
        // Una sola persona coincide: se completa el número en el título.
        const c = found[0];
        phone = c.phone;
        contactId = c.contactId;
        conversationId = c.conversationId;
        matchState = "auto";
        newTitle = withPhone(title, c.phone);
      } else {
        matchState = found.length > 1 ? "ambiguous" : "unmatched";
        candidates = found.slice(0, 5);
        if (found.length > 1 && existing?.matchState !== "ambiguous" && start.getTime() > now.getTime()) {
          newlyAmbiguous.push(parsed.name);
        }
      }
    }

    if (newTitle !== title && patchTitle) {
      try {
        await patchTitle(ev.id, newTitle);
        result.titled++;
      } catch (e) {
        console.warn("[citas] no se pudo completar el título", ev.id, e);
        newTitle = title;
      }
    }
    if (matchState === "ambiguous") result.ambiguous++;
    if (phone) result.linked++;

    const data = {
      googleAccountId: googleAccountId ?? existing?.googleAccountId ?? null,
      startsAt: start,
      endsAt: end,
      title: newTitle,
      name: parsed.name,
      phone,
      sessionsLabel: parsed.counter,
      meetUrl: ev.hangoutLink ?? null,
      contactId,
      conversationId,
      source: booking ? "ai" : "manual",
      status: "active",
      matchState,
      candidates: candidates ? (candidates as unknown as Prisma.InputJsonValue) : Prisma.DbNull,
    };
    await prisma.calendarAppointment.upsert({
      where: { eventId: ev.id },
      create: { eventId: ev.id, ...data },
      // Si la hora cambió, el recordatorio se vuelve a mandar para la hora nueva.
      update: {
        ...data,
        ...(existing && existing.startsAt.getTime() !== start.getTime()
          ? {
              reminderSentAt: null,
              reminderError: null,
              confirmedAt: null,
              reminderSoonSentAt: null,
              reminderSoonError: null,
              reminderSoonSkipped: null,
            }
          : {}),
      },
    });
    // Cita recién ligada (o movida): lo que la persona pidió antes ya quedó atendido.
    if (appointmentJustLinked({ before: existing, phone, contactId, startsAt: start, now })) {
      toResolve.push({ conversationId, phone, contactId, until: appointmentCoversUntil(ev.updated, startedAt) });
    }
  }

  // Sesiones de paquete escritas a mano, sin número («3.6 jesus terapia…»,
  // 17-oct): se ligan al chat al que Dayana mandó la invitación con ese enlace
  // de Meet. Sin eso Jesús, con 6 sesiones, figuraba como «no consta que haya
  // comprado» y la IA le contestaba como a un interesado.
  const meetLinked = await linkSessionsByMeet(seenIds, now).catch((e: unknown) => {
    console.warn("[citas] no se pudo ligar por el enlace de Meet", e);
    return [] as { conversationId: string; phone: string | null; contactId: string | null; startsAt: Date }[];
  });
  for (const m of meetLinked) {
    result.linked++;
    if (m.startsAt.getTime() > now.getTime()) {
      toResolve.push({ conversationId: m.conversationId, phone: m.phone, contactId: m.contactId, until: startedAt });
    }
  }
  // Su estado (clienta) lo recalcula quien llamó (`tick.ts`): segment-store usa este módulo.
  result.meetLinkedChats = [...new Set(meetLinked.map((m) => m.conversationId))];

  // Lo que ya no está en el calendario (dentro de la ventana leída) se cancela.
  const gone = await prisma.calendarAppointment.updateMany({
    where: {
      status: "active",
      eventId: { notIn: seenIds.length ? seenIds : ["-"] },
      startsAt: { gte: new Date(now.getTime() - 30 * DAY), lte: new Date(now.getTime() + 30 * DAY) },
    },
    data: { status: "cancelled" },
  });
  result.cancelled = gone.count;

  for (const r of toResolve) {
    const ids = await resolveConversations(
      { ids: [r.conversationId], phones: [r.phone], contactIds: [r.contactId] },
      "appointment",
      null,
      { seenInboundAt: r.until }
    ).catch((e: unknown) => {
      console.warn("[citas] no se pudo marcar el chat como atendido", e);
      return [] as string[];
    });
    result.resolved += ids.length;
  }

  if (newlyAmbiguous.length) {
    fireNotification({
      eventType: "WHATSAPP_AI_INFO",
      title: `Citas sin número: ${newlyAmbiguous.slice(0, 3).join(", ")}${newlyAmbiguous.length > 3 ? "…" : ""}`,
      body: "Hay varias personas con ese nombre. Elige quién es en WhatsApp → Agenda para mandarle el recordatorio.",
      href: "/admin/whatsapp/agenda",
      entityType: "CalendarAppointment",
      entityId: "sync",
      staff: "ALL",
    });
  }
  return result;
};

/** Dayana eligió quién es (o escribió el número): se guarda y se completa el título. */
export const confirmAppointmentPerson = async (input: {
  appointmentId: string;
  phoneE164: string;
  patchTitle?: (eventId: string, summary: string) => Promise<void>;
}): Promise<void> => {
  const startedAt = new Date();
  const appt = await prisma.calendarAppointment.findUniqueOrThrow({ where: { id: input.appointmentId } });
  const phone = whatsAppDigits(input.phoneE164);
  const who = await byPhone(phone);
  const newTitle = withPhone(appt.title, phone);
  let patch = input.patchTitle;
  if (!patch) {
    const config = await getWhatsAppAiConfig();
    const { token } = await resolveGoogleAccount("CALENDAR", config.booking.accountId || undefined);
    patch = async (eventId, summary) => {
      await patchEventText(token, eventId, { summary });
    };
  }
  if (newTitle !== appt.title) await patch(appt.eventId, newTitle);
  await prisma.calendarAppointment.update({
    where: { id: appt.id },
    data: { phone, title: newTitle, contactId: who.contactId, conversationId: who.conversationId, matchState: "confirmed", candidates: Prisma.DbNull },
  });
  // Dayana dijo de quién es la cita: su chat queda atendido (si la cita sigue en pie).
  if (appt.status === "active" && appt.startsAt.getTime() > startedAt.getTime()) {
    await resolveConversations(
      { ids: [who.conversationId], phones: [phone], contactIds: [who.contactId] },
      "appointment",
      null,
      { seenInboundAt: startedAt }
    ).catch((e: unknown) => console.warn("[citas] no se pudo marcar el chat como atendido", e));
  }
};

/** ¿Toca recordarle? Entre 23 y 25 h antes (el reloj pasa cada 10 min). */
export const isReminderDue = (startsAt: Date, now: Date): boolean => {
  const hours = (startsAt.getTime() - now.getTime()) / 3600_000;
  return hours >= 23 && hours <= 25;
};

const fmt = (d: Date, tz: string, opts: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat("es-CO", { timeZone: tz, ...opts }).format(d);

/** La llamada gratis la hace Dayana por WhatsApp al número de la persona. */
export const FREE_CALL_BY_WHATSAPP = "Dayana te llamará por WhatsApp a este número.";

export type ReminderResult = { sent: number; failed: number; skipped: number };

/** Recordatorio de WhatsApp 24 h antes. Cada cita se reclama antes de enviar: sale una sola vez. */
export const sendDueReminders = async (opts: { now?: Date } = {}): Promise<ReminderResult> => {
  const now = opts.now ?? new Date();
  const result: ReminderResult = { sent: 0, failed: 0, skipped: 0 };
  const due = await prisma.calendarAppointment.findMany({
    where: {
      status: "active",
      reminderSentAt: null,
      phone: { not: null },
      startsAt: { gte: new Date(now.getTime() + 23 * 3600_000), lte: new Date(now.getTime() + 25 * 3600_000) },
    },
    orderBy: { startsAt: "asc" },
    take: 30,
  });
  if (due.length === 0) return result;
  const tz = await getOperationalTimezone();

  for (const appt of due) {
    // Solo la llamada gratis (la dueña, 17-oct: «el recordatorio no es para
    // los clientes»). Las sesiones las coordina Dayana con cada persona.
    if (!isFreeCallAppointment(appt)) continue;
    // Reclamo: si otro proceso ya lo tomó, no se manda dos veces.
    const claimed = await prisma.calendarAppointment.updateMany({
      where: { id: appt.id, reminderSentAt: null },
      data: { reminderSentAt: now, reminderError: null },
    });
    if (claimed.count === 0) continue;

    const recipient = (appt.contactId ? await recipientFromContact(appt.contactId) : null) ?? {
      contactId: appt.contactId,
      phoneE164: `+${appt.phone}`,
      name: appt.name,
      optedOut: false,
    };
    const contactTz = appt.contactId
      ? trustedContactTimezone(
          await prisma.contact.findUnique({ where: { id: appt.contactId }, select: { timezone: true, countryIso: true, phoneCountryIso: true } })
        )
      : null;
    const zone = contactTz || tz;
    // La llamada gratis es por WhatsApp: no hay enlace que mandar.
    const freeCall = !appt.meetUrl && isFreeCallAppointment(appt);
    const vars = {
      // Solo un nombre seguro (el del chat o el que Dayana escribió en su calendario).
      nombre: (await appointmentGreetingName(appt)) ?? "",
      servicio: freeCall
        ? "tu llamada gratis con Dayana"
        : appt.sessionsLabel && appt.sessionsLabel !== "0/0"
          ? `tu sesión ${appt.sessionsLabel}`
          : "tu consulta",
      fecha: fmt(appt.startsAt, zone, { weekday: "long", day: "numeric", month: "long" }),
      hora: fmt(appt.startsAt, zone, { hour: "numeric", minute: "2-digit" }),
      enlace: freeCall ? FREE_CALL_BY_WHATSAPP : (appt.meetUrl ?? "(te lo mando antes de la cita)"),
    };
    const link = freeCall ? ` ${FREE_CALL_BY_WHATSAPP}` : appt.meetUrl ? ` Enlace: ${appt.meetUrl}` : "";
    const text = `Hola${vars.nombre ? ` ${vars.nombre}` : ""} 🙏 Te recuerdo ${vars.servicio} mañana ${vars.fecha} a las ${vars.hora}.${link} Responde SÍ para confirmar o escríbeme si necesitas cambiarla.`;

    const r = await sendWhatsAppToRecipient({
      recipient,
      text,
      templateKey: "cita_recordatorio",
      vars,
      source: `recordatorio:${appt.eventId}`,
      isAutoReply: true,
      clientKey: `reminder:${appt.eventId}:${appt.startsAt.getTime()}`,
    }).catch((e: unknown) => ({ status: "failed" as const, error: e instanceof Error ? e.message : String(e) }));

    if (r.status === "sent") {
      result.sent++;
      continue;
    }
    const reason =
      r.status === "skipped"
        ? r.reason === "needs_template"
          ? "Falta aprobar la plantilla de recordatorio de cita (WhatsApp → Plantillas)."
          : r.reason === "opted_out"
            ? "Pidió no recibir WhatsApp."
            : "Sin número válido."
        : r.error;
    await prisma.calendarAppointment.update({ where: { id: appt.id }, data: { reminderError: reason.slice(0, 300) } });
    if (r.status === "skipped") result.skipped++;
    else result.failed++;
    fireNotification({
      eventType: "WHATSAPP_AI_INFO",
      title: `No pude recordarle la cita a ${appt.name ?? `+${appt.phone}`}`,
      body: reason.slice(0, 200),
      href: "/admin/whatsapp/agenda",
      entityType: "CalendarAppointment",
      entityId: appt.id,
      staff: "ALL",
    });
  }
  return result;
};

/** La zona de la persona: la de su ficha (de dónde escribe), la de su contacto o la de Dayana. */
const personZone = async (
  appt: { conversationId: string | null; contactId: string | null },
  fallback: string
): Promise<string> => {
  const [dossier, contact] = await Promise.all([
    appt.conversationId
      ? prisma.whatsAppDossier.findUnique({ where: { conversationId: appt.conversationId }, select: { timezone: true } })
      : null,
    appt.contactId
      ? prisma.contact.findUnique({ where: { id: appt.contactId }, select: { timezone: true, countryIso: true, phoneCountryIso: true } })
      : null,
  ]);
  return [dossier?.timezone, trustedContactTimezone(contact)].find((tz): tz is string => Boolean(tz && isValidIanaTimeZone(tz))) ?? fallback;
};

export type SoonReminderResult = ReminderResult & {
  /** Se agendó poco antes: la confirmación ya le dijo la hora. */
  notNeeded: number;
};

/**
 * Recordatorio de la llamada gratis una hora antes («hoy a las… Dayana te
 * llamará por WhatsApp, ten a mano un espacio tranquilo»). Reglas en
 * `free-call-reminder-rules.ts`. Como el de 24 h, cada cita se reclama antes
 * de enviar: el reloj de GitHub y el que va pegado a los avisos de WhatsApp
 * (`tick.ts`) nunca lo mandan dos veces. Lo que falla no se reintenta solo
 * (fuera de las 24 h es una plantilla y se cobra).
 */
export const sendSoonReminders = async (
  opts: { now?: Date; config?: WhatsAppAiConfig } = {}
): Promise<SoonReminderResult> => {
  const now = opts.now ?? new Date();
  const result: SoonReminderResult = { sent: 0, failed: 0, skipped: 0, notNeeded: 0 };
  const settings = (opts.config ?? (await getWhatsAppAiConfig())).freeCallReminder;
  if (!settings.enabled) return result;
  const { from, to } = soonReminderWindow(now, settings.minutesBefore);
  const due = await prisma.calendarAppointment.findMany({
    where: {
      status: "active",
      reminderSoonSentAt: null,
      phone: { not: null },
      // La llamada gratis no lleva Meet: Dayana llama por WhatsApp.
      meetUrl: null,
      startsAt: { gte: from, lte: to },
    },
    orderBy: { startsAt: "asc" },
    take: 30,
  });
  if (due.length === 0) return result;
  const tz = await getOperationalTimezone();

  for (const appt of due) {
    const booking = await prisma.whatsAppBooking.findFirst({
      where: { calendarEventId: appt.eventId },
      orderBy: { createdAt: "desc" },
      select: { service: true, createdAt: true },
    });
    // Una sesión pagada no recibe este (solo el de 24 h). No se marca: si el
    // título cambia a llamada gratis, todavía le llega.
    if (!isFreeCallAppointment({ ...appt, bookingService: booking?.service ?? null })) continue;
    // Cuándo se agendó: la reserva de la IA, o si la puso Dayana, cuando el
    // reloj vio la cita por primera vez (lee el calendario cada 15 min).
    const decision = soonReminderDecision({
      startsAt: appt.startsAt,
      bookedAt: booking?.createdAt ?? appt.createdAt,
      now,
      minutesBefore: settings.minutesBefore,
    });
    if (decision.kind === "not_yet" || decision.kind === "too_late") continue;
    if (decision.kind === "skip") {
      // Se marca para no volver a revisarla (y para que la Agenda diga por qué).
      const marked = await prisma.calendarAppointment.updateMany({
        where: { id: appt.id, reminderSoonSentAt: null },
        data: { reminderSoonSentAt: now, reminderSoonSkipped: decision.reason.slice(0, 300) },
      });
      result.notNeeded += marked.count;
      continue;
    }

    // Reclamo: si otro proceso ya lo tomó, no se manda dos veces.
    const claimed = await prisma.calendarAppointment.updateMany({
      where: { id: appt.id, reminderSoonSentAt: null },
      data: { reminderSoonSentAt: now, reminderSoonError: null, reminderSoonSkipped: null },
    });
    if (claimed.count === 0) continue;

    const fromContact = appt.contactId ? await recipientFromContact(appt.contactId) : null;
    const recipient: RecipientInfo = fromContact?.phoneE164
      ? fromContact
      : { contactId: appt.contactId, phoneE164: `+${appt.phone}`, name: fromContact?.name ?? appt.name, optedOut: fromContact?.optedOut ?? false };
    // Solo un nombre seguro (el del chat o el que Dayana escribió en su calendario); si no, ninguno.
    const name = await appointmentGreetingName(appt);
    const zone = await personZone(appt, tz);
    const r = await sendWhatsAppToRecipient({
      recipient,
      text: freeCallReminderText({ template: settings.message, name, startsAt: appt.startsAt, timeZone: zone }),
      templateKey: "cita_recordatorio_hoy",
      vars: { nombre: personFirstName(name) ?? "", hora: getTimeLabelInTz(appt.startsAt, zone) },
      // `recordatorio:` y `reminder:`: sale solo; no cuenta como que Dayana
      // contestó y la IA no aprende de él (`whatsapp-attention-rules.ts`).
      source: `recordatorio:1h:${appt.eventId}`,
      isAutoReply: true,
      clientKey: `reminder:1h:${appt.eventId}:${appt.startsAt.getTime()}`,
    }).catch((e: unknown) => ({ status: "failed" as const, error: e instanceof Error ? e.message : String(e) }));

    if (r.status === "sent") {
      result.sent++;
      continue;
    }
    const reason =
      r.status === "skipped"
        ? r.reason === "needs_template"
          ? "Falta aprobar la plantilla «Llamada gratis: recordatorio de hoy» (WhatsApp → Plantillas)."
          : r.reason === "opted_out"
            ? "Pidió no recibir WhatsApp."
            : "Sin número válido."
        : r.error;
    await prisma.calendarAppointment.update({ where: { id: appt.id }, data: { reminderSoonError: reason.slice(0, 300) } });
    if (r.status === "skipped") result.skipped++;
    else result.failed++;
    fireNotification({
      eventType: "WHATSAPP_AI_INFO",
      title: `No pude recordarle la llamada gratis de hoy a ${appt.name ?? `+${appt.phone}`}`,
      body: reason.slice(0, 200),
      href: "/admin/whatsapp/agenda",
      entityType: "CalendarAppointment",
      entityId: appt.id,
      staff: "ALL",
    });
  }
  return result;
};

/**
 * La persona respondió «sí»: queda confirmada (y se anota en el evento).
 * `seenInboundAt`: el último mensaje suyo que se leyó al confirmar (la IA
 * trabaja con la conversación que cargó antes de pensar). Sin él, cuenta
 * hasta ahora.
 */
export const confirmAppointment = async (
  appointmentId: string,
  opts: { seenInboundAt?: Date | null } = {}
): Promise<void> => {
  const seenInboundAt = opts.seenInboundAt ?? new Date();
  const appt = await prisma.calendarAppointment.update({
    where: { id: appointmentId },
    data: { confirmedAt: new Date() },
    select: { conversationId: true, phone: true, contactId: true },
  });
  // Confirmó su cita: el chat queda atendido. Lo que escribió después de lo
  // leído sigue pendiente (y si vuelve a escribir, se reabre).
  await resolveConversations(
    { ids: [appt.conversationId], phones: [appt.phone], contactIds: [appt.contactId] },
    "appointment",
    null,
    { seenInboundAt }
  ).catch((e: unknown) => console.warn("[citas] no se pudo marcar el chat como atendido", e));
};

/** Próxima cita (y la última) de una persona, para la IA y la pantalla. */
export const appointmentsFor = async (input: { contactId?: string | null; phone?: string | null }) => {
  const or: Prisma.CalendarAppointmentWhereInput[] = [];
  if (input.contactId) or.push({ contactId: input.contactId });
  // Las citas guardan el teléfono; un id de usuario (BSUID) no lo trae.
  if (input.phone && !isWhatsAppUserId(input.phone)) {
    const phones = [input.phone, whatsAppDigits(`+${input.phone}`)].flatMap(whatsAppIdVariants);
    if (phones.length) or.push({ phone: { in: [...new Set(phones)] } });
  }
  if (or.length === 0) return { next: null, last: null };
  const now = new Date();
  const [next, last] = await Promise.all([
    prisma.calendarAppointment.findFirst({ where: { OR: or, status: "active", startsAt: { gte: now } }, orderBy: { startsAt: "asc" } }),
    prisma.calendarAppointment.findFirst({ where: { OR: or, status: "active", startsAt: { lt: now } }, orderBy: { startsAt: "desc" } }),
  ]);
  return { next, last };
};
