import { createHmac, randomBytes } from "node:crypto";
import { after } from "next/server";
import type { CountryCode } from "libphonenumber-js";

import { buildWhatsAppUrl } from "@/lib/contact";
import { prisma } from "@/lib/db";
import { resolveWhatsAppThreadId } from "@/lib/meta/whatsapp-thread";
import { fireNotification } from "@/lib/notifications/platform/emit";
import { personFirstName } from "@/lib/person-name";
import { normalizePhone, normalizePhoneWithCountry } from "@/lib/phone";
import { getSiteUrl } from "@/lib/site-url";
import { contactPhoneCandidates, whatsAppDigits } from "@/lib/whatsapp-contact";

import { upsertContactByPhone } from "../contacts";
import { getOperationalTimezone } from "../operational-timezone";
import { ensureContactTag } from "../tags";
import { getWhatsAppAiConfig } from "../whatsapp-ai-config";
import { isBlockedPhone } from "../whatsapp-blocked-numbers";
import { isIgnoredNumber } from "../whatsapp-ignored-numbers";
import { ensureWhatsAppConversation } from "../whatsapp-outbound";
import {
  afterFreeCallMoved,
  bookFreeCall,
  FreeCallError,
  freeCallService,
  fullFreeCallDays,
  moveFreeCall,
} from "../whatsapp-agent/free-call";
import { CANCELLED_BOOKING, dualZoneLabel } from "../whatsapp-agent/free-call-rules";
import { computeSegment } from "../whatsapp-agent/segment-store";
import { funnelCalendar, removeCalendarEvent } from "./calendar";
import { getCallFunnelConfig } from "./config";
import {
  answersNote,
  channelOf,
  CHANNEL_LABEL,
  confirmMessage,
  contactSourceFor,
  googleCalendarUrl,
  helpMessage,
  isOfferedSlot,
  pickFunnelSlots,
  readAnswers,
  sourceDetailFor,
  STAGE_LABEL,
  stageOf,
  topicLabel,
  interestLabels,
  goalLabel,
  investLabel,
  urgencyLabel,
  type AnswersInput,
  type Attribution,
  type Channel,
  type FunnelSlot,
  type LeadStage,
  type StartInput,
} from "./rules";

/**
 * El embudo de la llamada gratis en la web: lo que toca la base y el
 * calendario. Las reglas, en `rules.ts`.
 *
 * La cita que sale de aquí es LA MISMA que agenda la asistente de WhatsApp
 * (`bookFreeCall`): mismo candado contra dos personas en la misma hora, mismo
 * tope por día, mismo evento en el calendario de Dayana, misma fila en la
 * Agenda del CRM, mismos recordatorios y el mismo seguimiento («¿pudiste
 * hablar con Dayana?»). No hay un segundo sistema de citas.
 *
 * El formulario es público, así que sigue las reglas del registro del taller
 * (revisión 28-oct): el contacto es el del NÚMERO, nunca el del correo; a un
 * contacto que ya existe no se le cambia el nombre, el teléfono ni el correo;
 * y cada envío tiene su propio enlace secreto, así que escribir el número de
 * otra persona no da acceso a su cita.
 */

export const CALL_FUNNEL_TAG = { slug: "llamada-web", label: "Llamada gratis (web)" } as const;

const ORIGIN = "Agendada por la persona en la página web (/llamada).";

const TOKEN = /^[A-Za-z0-9_-]{24,64}$/;

const stamp = (now: Date): string => now.toLocaleDateString("es-CO", { dateStyle: "medium", timeZone: "America/Bogota" });

const appendNote = async (contactId: string, line: string): Promise<void> => {
  const current = await prisma.contact.findUnique({ where: { id: contactId }, select: { notes: true } });
  await prisma.contact.update({ where: { id: contactId }, data: { notes: current?.notes ? `${current.notes}\n${line}` : line } });
};

/** Todas las formas en que puede estar guardado ese número (MX 52/521, AR 54/549, BR con o sin 9). */
const phoneForms = (phoneE164: string): string[] => [...new Set([phoneE164, ...contactPhoneCandidates(whatsAppDigits(phoneE164))])];

/** El chat de WhatsApp que ya tiene ese número, sin crear ni tocar nada. */
const existingChatForPhone = async (phoneE164: string): Promise<{ id: string; contactId: string | null } | null> => {
  const waId = whatsAppDigits(phoneE164);
  const thread = await resolveWhatsAppThreadId(waId);
  return prisma.conversation.findFirst({
    where: { channel: "WHATSAPP", externalThreadId: { in: [...new Set([thread, waId, phoneE164.replace(/\D/g, "")])] } },
    orderBy: { lastMessageAt: "desc" },
    select: { id: true, contactId: true },
  });
};

// ── Paso 1: datos ───────────────────────────────────────────────────────────

export type StartResult =
  | {
      status: "ok";
      token: string;
      leadId: string;
      contactId: string;
      conversationId: string | null;
      phoneE164: string;
      /** El contacto no existía. */
      created: boolean;
      /** Es la primera vez que este contacto entra al embudo (para avisar al equipo una sola vez). */
      firstTime: boolean;
    }
  /** Un número bloqueado: no se guarda nada (la página responde igual que a todos). */
  | { status: "blocked" };

/** Lanza `INVALID_PHONE` si el número no sirve. */
export const startLead = async (input: StartInput): Promise<StartResult> => {
  const country = (input.phoneCountry ?? "CO") as CountryCode;
  const normalized = normalizePhoneWithCountry(input.phone, country) ?? normalizePhone(input.phone, country);
  if (!normalized) throw new Error("INVALID_PHONE");
  const phoneE164 = normalized.phoneE164;
  if (await isBlockedPhone(phoneE164).catch(() => false)) return { status: "blocked" };

  // El contacto es el del NÚMERO (a donde Dayana va a llamar).
  const owners = await prisma.contact.findMany({
    where: { phoneE164: { in: phoneForms(phoneE164) } },
    select: { id: true, phoneE164: true, firstName: true },
  });
  const owner = owners.find((o) => o.phoneE164 === phoneE164) ?? owners[0] ?? null;
  let contactId: string;
  if (!owner) {
    const { contact } = await upsertContactByPhone({
      phone: phoneE164,
      phoneCountry: normalized.phoneCountryIso,
      countryIso: normalized.phoneCountryIso,
      firstName: input.firstName,
      lastName: input.lastName ?? undefined,
      source: contactSourceFor(input.attribution),
      sourceDetail: sourceDetailFor(input.attribution),
      consentData: true,
      consentMarketing: input.consentMarketing,
      // La zona del navegador: con ella salen los recordatorios en SU hora.
      timezone: input.timezone ?? undefined,
    });
    contactId = contact.id;
  } else {
    // Ya existe: el formulario público no le cambia nada a nadie. Solo completa
    // el nombre si no tenía. Tampoco le anota permisos: nadie verifica que el
    // número sea de quien lo escribe, y un permiso de marketing ajeno haría a
    // ese contacto elegible para invitaciones (revisión 10-nov).
    const nameless = !personFirstName(owner.firstName) || owner.firstName === owner.phoneE164;
    await prisma.contact.update({
      where: { id: owner.id },
      data: {
        ...(nameless
          ? {
              firstName: input.firstName,
              lastName: input.lastName,
              displayName: [input.firstName, input.lastName].filter(Boolean).join(" "),
            }
          : {}),
      },
    });
    contactId = owner.id;
  }
  await ensureContactTag(contactId, CALL_FUNNEL_TAG.slug, CALL_FUNNEL_TAG.label).catch((e: unknown) =>
    console.warn("[llamada-web] no se pudo poner la etiqueta", e)
  );

  // Su chat de WhatsApp: ahí queda la cita, ahí le llegan los recordatorios y
  // ahí cae lo que escriba. Un número personal de Dayana no tiene chat.
  let conversationId: string | null = null;
  if (!(await isIgnoredNumber(whatsAppDigits(phoneE164)).catch(() => false))) {
    const existing = await existingChatForPhone(phoneE164);
    if (existing) {
      conversationId = existing.id;
      if (!existing.contactId) {
        await prisma.conversation.updateMany({ where: { id: existing.id, contactId: null }, data: { contactId } });
      }
    } else {
      const name = [input.firstName, input.lastName].filter(Boolean).join(" ").trim() || null;
      conversationId = (await ensureWhatsAppConversation({ phoneE164, contactId, name })).id;
    }
  }

  const firstTime = (await prisma.callFunnelLead.count({ where: { contactId } })) === 0;
  const a = input.attribution;
  const lead = await prisma.callFunnelLead.create({
    data: {
      token: randomBytes(24).toString("base64url"),
      contactId,
      conversationId,
      firstName: input.firstName,
      timezone: input.timezone,
      countryIso: normalized.phoneCountryIso ?? null,
      utmSource: a.utmSource,
      utmMedium: a.utmMedium,
      utmCampaign: a.utmCampaign,
      utmContent: a.utmContent,
      utmTerm: a.utmTerm,
      fbclid: a.fbclid,
      ttclid: a.ttclid,
      gclid: a.gclid,
      ref: a.ref,
      referrer: a.referrer,
      landingPath: a.landingPath,
    },
    select: { id: true, token: true },
  });
  return { status: "ok", token: lead.token, leadId: lead.id, contactId, conversationId, phoneE164, created: !owner, firstTime };
};

const LEAD = {
  id: true,
  token: true,
  contactId: true,
  conversationId: true,
  firstName: true,
  timezone: true,
  answers: true,
  answeredAt: true,
  bookingId: true,
  bookedAt: true,
  cancelledAt: true,
  confirmClickAt: true,
  createdAt: true,
} as const;

const loadLead = async (token: string) => (TOKEN.test(token) ? prisma.callFunnelLead.findUnique({ where: { token }, select: LEAD }) : null);

// ── Paso 2: preguntas ───────────────────────────────────────────────────────

/** `false` si ese enlace no existe. */
export const saveAnswers = async (token: string, input: AnswersInput, deps: { now?: Date } = {}): Promise<boolean> => {
  const now = deps.now ?? new Date();
  const lead = await loadLead(token);
  if (!lead) return false;
  const { email: _email, ...answers } = input;
  void _email;
  await prisma.callFunnelLead.update({ where: { id: lead.id }, data: { answers, answeredAt: lead.answeredAt ?? now } });
  // La nota para Dayana, solo la primera vez (corregir una respuesta no llena las notas).
  if (!lead.answeredAt) {
    await appendNote(lead.contactId, answersNote(answers, stamp(now))).catch((e: unknown) =>
      console.warn("[llamada-web] no se pudo anotar en el contacto", e)
    );
  }
  // El correo solo completa uno que falta, solo si no es de otro contacto y SOLO
  // si este envío creó el contacto: nadie verifica el número, y el portal de
  // miembros liga las cuentas por correo (revisión 10-nov: un correo ajeno
  // puesto en el contacto de una clienta le daba acceso a su cuenta).
  const createdByThisLead = Date.now() - lead.createdAt.getTime() < 3600_000 && (await prisma.callFunnelLead.count({ where: { contactId: lead.contactId, createdAt: { lt: lead.createdAt } } })) === 0;
  if (input.email && createdByThisLead) {
    const [contact, taken] = await Promise.all([
      prisma.contact.findUnique({ where: { id: lead.contactId }, select: { email: true } }),
      prisma.contact.findUnique({ where: { email: input.email }, select: { id: true } }),
    ]);
    if (contact && !contact.email && !taken) {
      await prisma.contact.update({ where: { id: lead.contactId }, data: { email: input.email } }).catch(() => undefined);
    }
  }
  return true;
};

// ── Paso 3: horas ───────────────────────────────────────────────────────────

export type SlotsResult =
  | {
      state: "ok";
      /** Las que se muestran: pocas por día, repartidas. */
      slots: FunnelSlot[];
      /**
       * Todas las horas libres de esos mismos días. Con estas se valida la que
       * la persona elige: cada cita nueva cambia el reparto de las que se
       * muestran, y una hora que sigue libre no puede dar «se ocupó» solo
       * porque dejó de salir en la lista.
       */
      bookable: FunnelSlot[];
      minutes: number;
      dayanaTz: string;
    }
  /**
   * `closed`: la página o la agenda están apagadas. `calendar`: el calendario no
   * respondió. `empty`: no hay horas libres en los próximos días.
   */
  | { state: "unavailable"; reason: "closed" | "calendar" | "empty" };

/** Las horas que la página muestra ahora mismo (las mismas para todos). */
export const funnelSlots = async (deps: { now?: Date } = {}): Promise<SlotsResult> => {
  const now = deps.now ?? new Date();
  const [funnel, config, dayanaTz] = await Promise.all([getCallFunnelConfig(), getWhatsAppAiConfig(), getOperationalTimezone()]);
  if (!funnel.enabled || !config.booking.enabled) return { state: "unavailable", reason: "closed" };
  const service = freeCallService(config);
  let all: Awaited<ReturnType<ReturnType<typeof funnelCalendar>["available"]>>;
  try {
    all = await funnelCalendar().available({ config: config.booking, durationMin: service.minutes, timezone: dayanaTz, now, limit: 2000 });
  } catch (e) {
    console.error("[llamada-web] no se pudo leer el calendario", e);
    return { state: "unavailable", reason: "calendar" };
  }
  const fullDays = await fullFreeCallDays(config, dayanaTz, now).catch(() => new Set<string>());
  const free = all.map((s) => ({ startIso: s.startIso, endIso: s.endIso, dateKey: s.dateKey }));
  const slots = pickFunnelSlots(free, { days: funnel.days, perDay: funnel.perDay, fullDays });
  if (!slots.length) return { state: "unavailable", reason: "empty" };
  const shownDays = new Set(slots.map((s) => s.dateKey));
  return { state: "ok", slots, bookable: free.filter((s) => shownDays.has(s.dateKey)), minutes: service.minutes, dayanaTz };
};

/**
 * La huella de una conexión (nunca la IP): con ella se cuenta cuántas llamadas
 * agendó en el día. El formulario es público y nadie comprueba que el número
 * sea de quien lo escribe; sin tope, alguien podría llenar el cupo diario de
 * Dayana con números inventados. `null` en desarrollo (no hay a quién limitar).
 */
export const funnelIpKey = (ip: string | null | undefined): string | null => {
  const clean = (ip ?? "").trim();
  if (!clean || clean === "unknown" || clean.startsWith("dev:")) return null;
  return createHmac("sha256", process.env.AUTH_SECRET || "call-funnel").update(`llamada:${clean}`).digest("hex").slice(0, 40);
};

const liveBooking = async (bookingId: string | null) => {
  if (!bookingId) return null;
  const booking = await prisma.whatsAppBooking.findUnique({
    where: { id: bookingId },
    select: { id: true, startsAt: true, endsAt: true, status: true, calendarEventId: true, conversationId: true },
  });
  return booking && !CANCELLED_BOOKING.includes(booking.status) ? booking : null;
};

export type BookResult =
  | { status: "booked"; startIso: string; endIso: string; moved: boolean }
  /** Esa hora ya no está (o el día se llenó): las horas de ahora. */
  | { status: "unavailable"; slots: FunnelSlot[] }
  /** Ese número ya tiene una llamada gratis por delante (de otro envío, o que agendó por WhatsApp). */
  | { status: "already_booked" }
  /** No se puede agendar por la página ahora (apagada, sin calendario, número sin chat). */
  | { status: "closed" }
  | { status: "not_found" };

const freshSlots = async (): Promise<FunnelSlot[]> => {
  const again = await funnelSlots().catch(() => null);
  return again?.state === "ok" ? again.slots : [];
};

/** Recalcula el estado de la persona en el CRM (sin esperar ni fallar por eso). */
const refreshStage = (conversationId: string) => {
  const task = () => computeSegment(conversationId).then(() => undefined).catch((e: unknown) => console.warn("[llamada-web] no se pudo recalcular el estado", e));
  // En Vercel la función se congela al responder: `after()` la deja terminar.
  try {
    after(task);
  } catch {
    void task();
  }
};

/**
 * Agenda la hora elegida. Si esta persona ya tenía su llamada (volvió a su
 * página y eligió otra hora), la mueve: nunca quedan dos.
 */
export const bookCall = async (token: string, startIso: string, opts: { ip?: string | null } = {}): Promise<BookResult> => {
  const lead = await loadLead(token);
  if (!lead) return { status: "not_found" };
  if (!lead.conversationId) return { status: "closed" };
  const [offered, funnel] = await Promise.all([funnelSlots(), getCallFunnelConfig()]);
  if (offered.state !== "ok") return { status: "closed" };
  if (!isOfferedSlot(startIso, offered.bookable)) return { status: "unavailable", slots: offered.slots };

  const [config, conversation] = await Promise.all([
    getWhatsAppAiConfig(),
    prisma.conversation.findUnique({ where: { id: lead.conversationId }, select: { externalThreadId: true } }),
  ]);
  if (!conversation) return { status: "closed" };
  const start = new Date(startIso);
  const personTz = lead.timezone ?? offered.dayanaTz;
  const current = await liveBooking(lead.bookingId);
  const calendar = funnelCalendar();
  const moving = Boolean(current && current.startsAt.getTime() > Date.now());
  // El tope por conexión: solo para una cita nueva (cambiar la propia no gasta).
  const ipKey = funnelIpKey(opts.ip);
  if (!moving && ipKey) {
    const sameIp = await prisma.callFunnelLead.count({
      where: { bookedIpHash: ipKey, bookedAt: { gte: new Date(Date.now() - 86_400_000) }, id: { not: lead.id } },
    });
    if (sameIp >= funnel.bookingsPerIpPerDay) {
      console.warn("[llamada-web] tope de citas por conexión y día", { limit: funnel.bookingsPerIpPerDay });
      return { status: "closed" };
    }
  }

  try {
    if (current && moving) {
      const moved = await moveFreeCall({ config, dayanaTz: offered.dayanaTz, personTz, bookingId: current.id, start, calendar });
      // La hora nueva no está confirmada (la confirmación era de la anterior).
      await prisma.callFunnelLead.update({ where: { id: lead.id }, data: { confirmClickAt: null, bookedAt: new Date() } }).catch(() => undefined);
      afterFreeCallMoved({ conversationId: lead.conversationId, booking: moved, dayanaTz: offered.dayanaTz });
      refreshStage(lead.conversationId);
      return { status: "booked", startIso: moved.startsAt.toISOString(), endIso: moved.endsAt.toISOString(), moved: true };
    }
    const booking = await bookFreeCall({
      config,
      dayanaTz: offered.dayanaTz,
      personTz,
      start,
      conversationId: lead.conversationId,
      contactId: lead.contactId,
      phone: conversation.externalThreadId,
      name: lead.firstName,
      calendar,
      origin: ORIGIN,
    });
    // La cita ya existe en el calendario: si esto falla, igual se responde
    // «agendada» (y el aviso sale); la fila se reparará cuando vuelva a su página.
    await prisma.callFunnelLead
      .update({
        where: { id: lead.id },
        data: { bookingId: booking.bookingId, bookedAt: new Date(), cancelledAt: null, confirmClickAt: null, bookedIpHash: ipKey },
      })
      .catch((e: unknown) => console.error("[llamada-web] la cita quedó agendada pero no se ligó a su fila", e));
    fireNotification({
      eventType: "WHATSAPP_AI_BOOKED",
      title: `Llamada gratis agendada: ${booking.title}`,
      body: `${dualZoneLabel(booking.startsAt.toISOString(), offered.dayanaTz, offered.dayanaTz)} · la agendó en la página web. La llamas por WhatsApp.`,
      href: `/admin/whatsapp?conversation=${lead.conversationId}`,
      entityType: "Conversation",
      entityId: lead.conversationId,
      staff: "ALL",
    });
    refreshStage(lead.conversationId);
    return { status: "booked", startIso: booking.startsAt.toISOString(), endIso: booking.endsAt.toISOString(), moved: false };
  } catch (e) {
    if (e instanceof FreeCallError) {
      console.warn("[llamada-web] no se agendó:", e.code, e.message);
      if (e.code === "already_booked") return { status: "already_booked" };
      if (e.code === "not_movable") return { status: "closed" };
      return { status: "unavailable", slots: await freshSlots() };
    }
    console.error("[llamada-web] no se pudo agendar", e);
    return { status: "closed" };
  }
};

export type CancelResult = { status: "cancelled" } | { status: "nothing" } | { status: "closed" } | { status: "not_found" };

/** Cancela la llamada de este enlace: se borra del calendario de Dayana y se libera la hora. */
export const cancelCall = async (token: string): Promise<CancelResult> => {
  const lead = await loadLead(token);
  if (!lead) return { status: "not_found" };
  const booking = await liveBooking(lead.bookingId);
  if (!booking || booking.startsAt.getTime() <= Date.now()) return { status: "nothing" };
  const [config, dayanaTz] = await Promise.all([getWhatsAppAiConfig(), getOperationalTimezone()]);
  // Primero el calendario: si Google no responde, nada cambia (decir «cancelada»
  // con el evento todavía en el calendario de Dayana sería peor).
  try {
    await removeCalendarEvent(config.booking, booking.calendarEventId);
  } catch (e) {
    console.error("[llamada-web] no se pudo borrar el evento del calendario", e);
    return { status: "closed" };
  }
  const done = await prisma.whatsAppBooking.updateMany({
    where: { id: booking.id, status: { notIn: CANCELLED_BOOKING } },
    data: { status: "CANCELLED" },
  });
  await prisma.calendarAppointment.updateMany({ where: { eventId: booking.calendarEventId }, data: { status: "cancelled" } });
  await prisma.callFunnelLead.update({ where: { id: lead.id }, data: { cancelledAt: new Date() } });
  if (done.count > 0) {
    fireNotification({
      eventType: "WHATSAPP_AI_BOOKED",
      title: `Llamada gratis cancelada: ${lead.firstName}`,
      body: `${dualZoneLabel(booking.startsAt.toISOString(), dayanaTz, dayanaTz)} · la canceló desde su página. Ya no está en tu calendario.`,
      href: `/admin/whatsapp?conversation=${booking.conversationId}`,
      entityType: "Conversation",
      entityId: booking.conversationId,
      staff: "ALL",
    });
    refreshStage(booking.conversationId);
  }
  return { status: "cancelled" };
};

/** Tocó «Confirmar por WhatsApp» en su página (solo la primera vez cuenta). */
export const noteConfirmClick = async (token: string): Promise<void> => {
  if (!TOKEN.test(token)) return;
  await prisma.callFunnelLead.updateMany({ where: { token, confirmClickAt: null, bookingId: { not: null } }, data: { confirmClickAt: new Date() } });
};

// ── Su página ───────────────────────────────────────────────────────────────

export type FunnelPage = {
  firstName: string;
  stage: LeadStage;
  /** Ya respondió las preguntas del paso 2. */
  answered: boolean;
  /** Su llamada (también la que ya pasó); `null` si nunca agendó o canceló. */
  call: { startIso: string; endIso: string; minutes: number } | null;
  /** Puede cambiarla o cancelarla (todavía no empieza). */
  canChange: boolean;
  /** Ya le escribió a Dayana después de agendar, o tocó «Confirmar». */
  confirmed: boolean;
  /** La zona que dio su navegador al registrarse, si se supo. */
  personTz: string | null;
  dayanaTz: string;
  /** wa.me con el mensaje de confirmación; solo con la llamada por delante. */
  confirmUrl: string | null;
  /** wa.me para pedir ayuda (siempre). */
  helpUrl: string;
  googleCalendarUrl: string | null;
  /** Ruta del archivo .ics (Apple, Outlook). */
  icsPath: string | null;
};

const bookingOf = async (lead: { bookingId: string | null }) => {
  if (!lead.bookingId) return { booking: null, callOutcome: null };
  const booking = await prisma.whatsAppBooking.findUnique({
    where: { id: lead.bookingId },
    select: { id: true, startsAt: true, endsAt: true, status: true, calendarEventId: true },
  });
  if (!booking) return { booking: null, callOutcome: null };
  const appointment = await prisma.calendarAppointment.findUnique({ where: { eventId: booking.calendarEventId }, select: { callOutcome: true } });
  return { booking, callOutcome: appointment?.callOutcome ?? null };
};

/** La URL pública de la página de la persona. */
export const funnelPageUrl = (token: string): string => `${getSiteUrl()}/llamada/${token}`;

/** Lo que muestra `/llamada/<token>`. `null`: ese enlace no existe. */
export const getFunnelPage = async (token: string, deps: { now?: Date } = {}): Promise<FunnelPage | null> => {
  const now = deps.now ?? new Date();
  const lead = await loadLead(token);
  if (!lead) return null;
  const [{ booking, callOutcome }, dayanaTz, conversation] = await Promise.all([
    bookingOf(lead),
    getOperationalTimezone(),
    lead.conversationId
      ? prisma.conversation.findUnique({ where: { id: lead.conversationId }, select: { lastInboundAt: true } })
      : Promise.resolve(null),
  ]);
  const stage = stageOf({ answeredAt: lead.answeredAt, cancelledAt: lead.cancelledAt, booking, callOutcome, now });
  const live = booking && !CANCELLED_BOOKING.includes(booking.status) ? booking : null;
  const upcoming = stage === "agendada" && live ? live : null;
  const startIso = live?.startsAt.toISOString();
  const endIso = live?.endsAt.toISOString();
  const url = funnelPageUrl(lead.token);
  return {
    firstName: lead.firstName,
    stage,
    answered: Boolean(lead.answeredAt),
    call: live && startIso && endIso ? { startIso, endIso, minutes: Math.round((live.endsAt.getTime() - live.startsAt.getTime()) / 60_000) } : null,
    canChange: Boolean(upcoming && upcoming.startsAt.getTime() > now.getTime()),
    confirmed: Boolean(
      lead.confirmClickAt || (lead.bookedAt && conversation?.lastInboundAt && conversation.lastInboundAt.getTime() > lead.bookedAt.getTime())
    ),
    personTz: lead.timezone,
    dayanaTz,
    confirmUrl: upcoming && startIso ? buildWhatsAppUrl(confirmMessage(lead.firstName, startIso, lead.timezone ?? dayanaTz, dayanaTz)) : null,
    helpUrl: buildWhatsAppUrl(helpMessage(lead.firstName, Boolean(live))),
    googleCalendarUrl: upcoming && startIso && endIso ? googleCalendarUrl({ startIso, endIso, url }) : null,
    icsPath: upcoming ? `/api/llamada/${lead.token}/calendario` : null,
  };
};

/** Los datos del .ics de su llamada; `null` si no tiene una por delante. */
export const getCallForIcs = async (token: string): Promise<{ uid: string; startIso: string; endIso: string; url: string } | null> => {
  const lead = await loadLead(token);
  const booking = lead ? await liveBooking(lead.bookingId) : null;
  if (!lead || !booking || booking.endsAt.getTime() <= Date.now()) return null;
  return { uid: booking.id, startIso: booking.startsAt.toISOString(), endIso: booking.endsAt.toISOString(), url: funnelPageUrl(lead.token) };
};

// ── El CRM ──────────────────────────────────────────────────────────────────

export const FOLLOW_UPS = ["nuevo", "contactada", "descartada"] as const;
export type FollowUp = (typeof FOLLOW_UPS)[number];

export type FunnelLeadRow = {
  id: string;
  contactId: string;
  conversationId: string | null;
  name: string;
  phoneE164: string;
  countryIso: string | null;
  stage: LeadStage;
  stageLabel: string;
  /** Cuándo dejó sus datos (ISO). */
  createdAt: string;
  channel: Channel;
  channelLabel: string;
  campaign: string | null;
  topic: string | null;
  urgency: string | null;
  /** Lo que le interesa (sesiones, cursos, talleres, eventos…). */
  interests: string[];
  /** A dónde quiere llegar. */
  goal: string | null;
  /** Si puede invertir en su proceso. */
  invest: string | null;
  occupation: string | null;
  social: string | null;
  note: string | null;
  call: { startIso: string; endIso: string } | null;
  /** Confirmó por WhatsApp (escribió después de agendar o tocó el botón). */
  confirmed: boolean;
  followUp: FollowUp;
  /** Cuántas veces dejó sus datos. */
  visits: number;
};

const attributionOf = (row: {
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  utmContent: string | null;
  utmTerm: string | null;
  fbclid: string | null;
  ttclid: string | null;
  gclid: string | null;
  ref: string | null;
  referrer: string | null;
  landingPath: string | null;
}): Attribution => ({
  utmSource: row.utmSource,
  utmMedium: row.utmMedium,
  utmCampaign: row.utmCampaign,
  utmContent: row.utmContent,
  utmTerm: row.utmTerm,
  fbclid: row.fbclid,
  ttclid: row.ttclid,
  gclid: row.gclid,
  ref: row.ref,
  referrer: row.referrer,
  landingPath: row.landingPath,
});

/**
 * Las personas del embudo, la más reciente primero: una fila por contacto (su
 * último envío; si alguna vez agendó, ese). El canal es el del PRIMER envío:
 * quien llegó por un reel y volvió escribiendo la dirección, llegó por el reel.
 */
export const listFunnelLeads = async (opts: { sinceDays?: number; limit?: number; now?: Date } = {}): Promise<FunnelLeadRow[]> => {
  const now = opts.now ?? new Date();
  const since = new Date(now.getTime() - (opts.sinceDays ?? 90) * 86_400_000);
  const rows = await prisma.callFunnelLead.findMany({
    where: { createdAt: { gte: since }, contact: { blockedAt: null } },
    orderBy: { createdAt: "desc" },
    take: 2000,
    include: { contact: { select: { firstName: true, lastName: true, displayName: true, phoneE164: true, countryIso: true } } },
  });
  const byContact = new Map<string, typeof rows>();
  for (const r of rows) byContact.set(r.contactId, [...(byContact.get(r.contactId) ?? []), r]);

  const picked = [...byContact.values()].map((list) => ({
    // La fila con cita gana; si no, la más reciente (la lista ya viene así).
    row: list.find((r) => r.bookingId && !r.cancelledAt) ?? list.find((r) => r.bookingId) ?? list[0],
    first: list[list.length - 1],
    visits: list.length,
    answered: list.find((r) => r.answers),
    latest: list[0],
  }));
  const bookingIds = picked.map((p) => p.row.bookingId).filter((x): x is string => Boolean(x));
  const bookings = bookingIds.length
    ? await prisma.whatsAppBooking.findMany({
        where: { id: { in: bookingIds } },
        select: { id: true, startsAt: true, endsAt: true, status: true, calendarEventId: true },
      })
    : [];
  const [appointments, conversations] = await Promise.all([
    bookings.length
      ? prisma.calendarAppointment.findMany({
          where: { eventId: { in: bookings.map((b) => b.calendarEventId) } },
          select: { eventId: true, callOutcome: true },
        })
      : Promise.resolve([]),
    prisma.conversation.findMany({
      where: { id: { in: picked.map((p) => p.row.conversationId).filter((x): x is string => Boolean(x)) } },
      select: { id: true, lastInboundAt: true },
    }),
  ]);
  const bookingById = new Map(bookings.map((b) => [b.id, b]));
  const outcomeByEvent = new Map(appointments.map((a) => [a.eventId, a.callOutcome]));
  const inboundByChat = new Map(conversations.map((c) => [c.id, c.lastInboundAt]));

  return picked
    .map(({ row, first, visits, answered, latest }): FunnelLeadRow => {
      const booking = row.bookingId ? (bookingById.get(row.bookingId) ?? null) : null;
      const stage = stageOf({
        answeredAt: row.answeredAt ?? answered?.answeredAt ?? null,
        cancelledAt: row.cancelledAt,
        booking,
        callOutcome: booking ? (outcomeByEvent.get(booking.calendarEventId) ?? null) : null,
        now,
      });
      const live = booking && !CANCELLED_BOOKING.includes(booking.status) ? booking : null;
      const answers = readAnswers(row.answers ?? answered?.answers);
      const attribution = attributionOf(first);
      const channel = channelOf(attribution);
      const inbound = row.conversationId ? inboundByChat.get(row.conversationId) : null;
      const c = row.contact;
      return {
        id: row.id,
        contactId: row.contactId,
        conversationId: row.conversationId,
        name: c.displayName?.trim() || [c.firstName, c.lastName].filter(Boolean).join(" ").trim() || row.firstName,
        phoneE164: c.phoneE164,
        countryIso: c.countryIso ?? row.countryIso,
        stage,
        stageLabel: STAGE_LABEL[stage],
        createdAt: latest.createdAt.toISOString(),
        channel,
        channelLabel: CHANNEL_LABEL[channel],
        campaign: attribution.utmCampaign,
        topic: topicLabel(answers?.topic),
        urgency: urgencyLabel(answers?.urgency),
        interests: interestLabels(answers?.interests),
        goal: goalLabel(answers?.goal),
        invest: investLabel(answers?.invest),
        occupation: answers?.occupation ?? null,
        social: answers?.social ?? null,
        note: answers?.note ?? null,
        call: live ? { startIso: live.startsAt.toISOString(), endIso: live.endsAt.toISOString() } : null,
        confirmed: Boolean(row.confirmClickAt || (row.bookedAt && inbound && inbound.getTime() > row.bookedAt.getTime())),
        followUp: (FOLLOW_UPS as readonly string[]).includes(row.followUp) ? (row.followUp as FollowUp) : "nuevo",
        visits,
      };
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, opts.limit ?? 500);
};

export type FunnelStats = {
  /** Dejaron sus datos. */
  leads: number;
  /** Respondieron las preguntas (o llegaron más lejos). */
  answered: number;
  /** Agendaron (aunque después cancelaran o no contestaran). */
  booked: number;
  /** De las que agendaron, confirmaron por WhatsApp. */
  confirmed: number;
  /** Hablaron con Dayana. */
  talked: number;
  noAnswer: number;
  /** Sin llamada: a quién hacerle seguimiento. */
  toFollowUp: number;
  byChannel: { channel: Channel; label: string; leads: number; booked: number }[];
};

const BOOKED_STAGES: LeadStage[] = ["agendada", "hablaron", "no_contesto", "pasada", "cancelada"];

/** Los números del embudo, de las mismas filas de la lista. */
export const funnelStats = (rows: FunnelLeadRow[]): FunnelStats => {
  const byChannel = new Map<Channel, { leads: number; booked: number }>();
  for (const r of rows) {
    const c = byChannel.get(r.channel) ?? { leads: 0, booked: 0 };
    c.leads += 1;
    if (BOOKED_STAGES.includes(r.stage)) c.booked += 1;
    byChannel.set(r.channel, c);
  }
  return {
    leads: rows.length,
    answered: rows.filter((r) => r.stage !== "datos").length,
    booked: rows.filter((r) => BOOKED_STAGES.includes(r.stage)).length,
    confirmed: rows.filter((r) => r.confirmed).length,
    talked: rows.filter((r) => r.stage === "hablaron").length,
    noAnswer: rows.filter((r) => r.stage === "no_contesto").length,
    toFollowUp: rows.filter((r) => ["datos", "preguntas", "cancelada"].includes(r.stage) && r.followUp === "nuevo").length,
    byChannel: [...byChannel]
      .map(([channel, v]) => ({ channel, label: CHANNEL_LABEL[channel], ...v }))
      .sort((a, b) => b.leads - a.leads),
  };
};

/** El seguimiento de Dayana a una persona del embudo. `false` si no existe. */
export const setLeadFollowUp = async (id: string, followUp: FollowUp): Promise<boolean> => {
  const done = await prisma.callFunnelLead.updateMany({ where: { id }, data: { followUp } });
  return done.count > 0;
};
