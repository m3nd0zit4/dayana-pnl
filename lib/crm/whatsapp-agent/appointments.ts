import { Prisma } from "@prisma/client";

import { resolveGoogleAccount } from "@/agent/lib/google";
import { prisma } from "@/lib/db";
import { listEvents, patchEventText, type CalendarEvent } from "@/lib/google/calendar";
import { fireNotification } from "@/lib/notifications/platform/emit";
import { contactPhoneCandidates, whatsAppDigits } from "@/lib/whatsapp-contact";
import { getOperationalTimezone } from "../operational-timezone";
import { getWhatsAppAiConfig } from "../whatsapp-ai-config";
import { recipientFromContact, sendWhatsAppToRecipient } from "../whatsapp-outbound";
import { isAvailabilityBlock } from "./calendar";
import { foldName, nameMatches, parseEventTitle, withPhone } from "./event-title";

/**
 * Las citas del Google Calendar de Dayana, ligadas a cada persona.
 *
 * - Lee el calendario (30 días atrás y 30 adelante), sin los bloques
 *   «Disponible» ni lo marcado como libre o cancelado.
 * - Liga cada cita con la persona: por el número del título, o por el nombre
 *   si hay UNA sola persona que coincide (y entonces le agrega el número al
 *   título, para que Dayana sepa quién es). Si hay dudas, le pregunta.
 * - Manda el recordatorio de WhatsApp 24 h antes, una sola vez.
 */

const DAY = 24 * 3600_000;

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
      where: { channel: "WHATSAPP", externalThreadId: { in: [thread, digits] } },
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

export type SyncResult = { seen: number; linked: number; titled: number; ambiguous: number; cancelled: number };

export const syncAppointments = async (deps: SyncDeps = {}): Promise<SyncResult> => {
  const now = deps.now ?? new Date();
  const result: SyncResult = { seen: 0, linked: 0, titled: 0, ambiguous: 0, cancelled: 0 };
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
    patchTitle = async (eventId, summary) => {
      await patchEventText(token, eventId, { summary });
    };
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
        ...(existing && existing.startsAt.getTime() !== start.getTime() ? { reminderSentAt: null, reminderError: null, confirmedAt: null } : {}),
      },
    });
  }

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
};

/** ¿Toca recordarle? Entre 23 y 25 h antes (el reloj pasa cada 10 min). */
export const isReminderDue = (startsAt: Date, now: Date): boolean => {
  const hours = (startsAt.getTime() - now.getTime()) / 3600_000;
  return hours >= 23 && hours <= 25;
};

const fmt = (d: Date, tz: string, opts: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat("es-CO", { timeZone: tz, ...opts }).format(d);

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
      ? (await prisma.contact.findUnique({ where: { id: appt.contactId }, select: { timezone: true } }))?.timezone
      : null;
    const zone = contactTz || tz;
    const vars = {
      nombre: (appt.name ?? recipient.name ?? "").split(" ")[0] || "",
      servicio: appt.sessionsLabel && appt.sessionsLabel !== "0/0" ? `tu sesión ${appt.sessionsLabel}` : "tu consulta",
      fecha: fmt(appt.startsAt, zone, { weekday: "long", day: "numeric", month: "long" }),
      hora: fmt(appt.startsAt, zone, { hour: "numeric", minute: "2-digit" }),
      enlace: appt.meetUrl ?? "(te lo mando antes de la cita)",
    };
    const text = `Hola ${vars.nombre} 💛 Te recuerdo ${vars.servicio === "tu consulta" ? "tu consulta" : vars.servicio} mañana ${vars.fecha} a las ${vars.hora}.${appt.meetUrl ? ` Enlace: ${appt.meetUrl}` : ""} Responde SÍ para confirmar o escríbeme si necesitas cambiarla.`;

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

/** La persona respondió «sí»: queda confirmada (y se anota en el evento). */
export const confirmAppointment = async (appointmentId: string): Promise<void> => {
  await prisma.calendarAppointment.update({ where: { id: appointmentId }, data: { confirmedAt: new Date() } });
};

/** Próxima cita (y la última) de una persona, para la IA y la pantalla. */
export const appointmentsFor = async (input: { contactId?: string | null; phone?: string | null }) => {
  const or: Prisma.CalendarAppointmentWhereInput[] = [];
  if (input.contactId) or.push({ contactId: input.contactId });
  if (input.phone) or.push({ phone: { in: [input.phone, whatsAppDigits(`+${input.phone}`)] } });
  if (or.length === 0) return { next: null, last: null };
  const now = new Date();
  const [next, last] = await Promise.all([
    prisma.calendarAppointment.findFirst({ where: { OR: or, status: "active", startsAt: { gte: now } }, orderBy: { startsAt: "asc" } }),
    prisma.calendarAppointment.findFirst({ where: { OR: or, status: "active", startsAt: { lt: now } }, orderBy: { startsAt: "desc" } }),
  ]);
  return { next, last };
};
