import { geminiProvider } from "@/lib/ai/gemini";
import { appointmentsFor, confirmAppointment } from "./appointments";
import { contactStage } from "../contact-stage";
import { getOperationalTimezone } from "../operational-timezone";
import { Prisma } from "@prisma/client";
import { generateText, hasToolCall, isStepCount, tool } from "ai";
import { z } from "zod";

import { prisma } from "@/lib/db";
import { BRAND } from "@/lib/contact";
import { getSiteUrl } from "@/lib/site-url";
import { getDateKeyInTz, getTimeLabelInTz, zonedDateTimeToUtc } from "@/lib/datetime/zoned-time";
import type { WhatsAppAiConfig } from "../whatsapp-ai-config";
import { findSimilarExamples, humanReplySql, notLearnableChatSql, type SimilarExample } from "../whatsapp-learning";
import { lastInboundSeen } from "../whatsapp-pending-rules";
import { availableSlots, SlotUnavailableError } from "./calendar";
import { diagnosticContextFor } from "../diagnostic-context";
import { playbooksBlock } from "./playbooks";
import { activePaymentLinkFor, enabledMethods, paymentDetails, paymentMethodsForPrompt } from "./payment-info";
import { dayanaOfferedSlot, saidPartOfDay, spreadSlots, wishFromWords, type WishStep } from "./slots";
import { redactPrices } from "./price-guard";
import { softenForPrompt, withDayanaWording } from "./wording";
import { countryName, describeRequestedTime, inferPersonZone, MULTI_ZONE_COUNTRIES, resolvePersonTimezone } from "./booking-time";
import { inferLocaleFromPhone } from "@/lib/contact-timezone";
import { isFreeCallAppointment } from "./event-title";
import { acceptedCallWithoutHours, availabilityArgs, flowState, flowStateText, leadBeforeHours, salesFlowRules } from "./sales-flow";
import { absoluteUrl, affordableOptions, asksToJoinCommunity, COMMUNITY_REPLY, communityLink, communityRules } from "./community";
import { spendLimits } from "./spend";
import {
  askedPackage,
  asksForBankDetails,
  CHAT_LINK_REPLY,
  isPaymentData,
  dayanaPaymentDataBodies,
  dayanaPaymentInfo,
  dayanaPaymentLinks,
  pickPaymentLink,
  withoutPayUrls,
} from "./chat-payment-link";
import { saysSelfHarm } from "./pause-rules";
import { asksForMoreHelp, seriousReply } from "./serious-reply";
import { answeringDayana, givesEmergencyAdvice, promisesHandoff, sharesAccount, typedPaymentData, urlKeys, withoutInventedUrls, withoutToolText } from "./reply-guards";
import { foldForSearch } from "../search-normalize";
import {
  URGENT_SESSION_REPLY,
  offersUrgentSession,
  urgencyInsisted,
  urgentLinkSent,
  urgentSessionAfter,
  urgentSessionPath,
  urgentSessionRules,
  withoutFakeLinks,
  withoutHoyMismo,
} from "./urgent-session";
import { personFullName } from "@/lib/person-name";
import { fixNameInReply, resolvePersonName, sureFirstName, type NameMessage, type NameResolution } from "@/lib/sure-name";
import { phoneFromWhatsAppId } from "@/lib/phone";
import { registeredEventLines, type RegisteredFreeEvent } from "./free-event-registration";
import { guestEventCounts, guestLine, guestReply, wantsProcess, type GuestEvent } from "./webinar-guest";
import {
  aboutOwnProcess,
  isWorkshopAsk,
  isWorkshopChoice,
  isWorkshopOffer,
  promisesWorkshopLink,
  saysNoWorkshop,
  wantsWorkshopSpot,
  withoutWorkshopPayUrls,
  withWorkshopStep,
  workshopFlowActive,
  workshopFollowLine,
  workshopLeadActive,
  workshopLine,
  mentionsPromo,
  workshopLinkReply,
  workshopPayLine,
  workshopReply,
  type OpenWorkshop,
} from "./workshop-interest";
import { enrolledInWorkshop, openWorkshopForAi } from "../workshop-interests";
import { asksHowToPay, quotePayReply, quotePromptLine, quoteSituation, withQuoteReminder } from "./quote-follow-up-rules";
import { bookedMessage, offerMessage, type OfferedSlot } from "./slot-choice";
import { NO_FREE_CALL_STAGES, STAGE_AI_RULE, STAGE_HELP, STAGE_LABEL, type Stage } from "./stage";
import {
  afterFreeCallBooked,
  afterFreeCallMoved,
  bookFreeCall,
  dualZoneLabel,
  FreeCallError,
  freeCallService,
  moveFreeCall,
  offeredFreeCallSlots,
  offerFreeCallSlotsFor,
  upcomingFreeCall,
} from "./free-call";

/**
 * El asistente de WhatsApp: lee el chat, decide y, si hace falta, usa
 * herramientas (ver la agenda, agendar, buscar cómo contestó Dayana antes,
 * pasar el chat a Dayana).
 *
 * No envía nada: devuelve qué hacer. Enviar, guardar borrador, avisar y
 * registrar tiempos es trabajo del ejecutor (`run.ts`). Así el botón «Probar»
 * del panel y el chat con el asistente ven exactamente la misma decisión que
 * saldría, sin efectos (en modo `preview` agendar se simula).
 */

export type EscalationCategory =
  | "payment"
  | "unknown"
  | "complaint"
  | "clinical"
  | "reschedule"
  | "other";

export type BrainOutcome =
  | { kind: "reply"; message: string }
  | {
      kind: "escalate";
      reason: string;
      category: EscalationCategory;
      severity: "normal" | "urgent";
    };

export type BrainBooking = {
  id: string;
  startsAt: Date;
  service: string;
  meetUrl: string | null;
};

export type BrainResult = {
  outcome: BrainOutcome;
  /** Sticker de Dayana para mandar después del texto, si la IA eligió uno. */
  stickerUrl: string | null;
  examples: SimilarExample[];
  toolCalls: { tool: string; input: unknown; output: unknown }[];
  booking: BrainBooking | null;
  /** Cita que la IA quiere agendar: espera la autorización de Dayana. */
  pendingBooking: {
    service: string;
    startIso: string;
    durationMin: number;
    name: string | null;
    label: string;
    /** La llamada gratis: Dayana llama por WhatsApp (sin enlace de Meet). */
    whatsappCall?: boolean;
  } | null;
  /** Enlace de pago que la IA quiere mandar: espera la autorización de Dayana. */
  pendingPayment: { productId: string; product: string } | null;
  /** Horas que la IA quiere ofrecer: Dayana las aprueba (o cambia) antes de que salgan. */
  pendingSlots: { service: string; options: { startIso: string; label: string }[] } | null;
  /**
   * Las horas de la llamada gratis ofrecidas en esta vuelta, en orden: van
   * debajo del mensaje, numeradas, pegadas por el código (`slot-choice.ts`).
   */
  slotOffer: { options: OfferedSlot[]; matchedWish: boolean | null } | null;
  /**
   * La llamada gratis se agendó o se movió en esta vuelta: la confirmación sale
   * del código con esta hora (`bookedMessage`), no del modelo. `text` es esa
   * confirmación, también cuando la vuelta termina escalando.
   */
  bookingNotice: { kind: "booked" | "moved"; label: string; text: string } | null;
  /**
   * Algo delicado que Dayana tiene que saber sin que la persona lo sepa: la
   * persona recibió una respuesta (apoyo o el paso del pago) y run.ts le avisa
   * a Dayana sin mensaje de espera (`serious-reply.ts`).
   */
  silentEscalation: { category: EscalationCategory; severity: "normal" | "urgent"; reason: string } | null;
  /** La respuesta es de lo delicado (apoyo o el paso del pago tras la llamada): sale siempre. */
  serious: boolean;
  /** En un pago ya hecho: lo que Dayana puede responder cuando lo verifique. */
  suggestedReply: string | null;
  /** Al escalar sin callarse: el aviso corto que recibe la persona ahora. */
  holdingReply: string | null;
  /** Datos de pago (texto exacto de Ajustes) y enlace que van debajo del mensaje. */
  paymentBlocks: { details: string[]; link: string | null };
  /** Otros enlaces que van debajo del mensaje: la comunidad, el curso. */
  linkBlocks: string[];
  /** Mandó el enlace de la sesión urgente (`urgent-session.ts`): Dayana recibe el aviso para agendarla. */
  urgentSession: { reason: string; asks: string[]; /** Lo que la IA quería escalar además. */ note?: string } | null;
  /** La persona mandó un comprobante (o dijo que pagó): queda por confirmar para Dayana. */
  receipt: {
    summary: string;
    method: string | null;
    amount: number | null;
    currency: string | null;
    reference: string | null;
    paidOn: string | null;
    payerName: string | null;
    problem: string | null;
    confirmMessage: string | null;
  } | null;
  /** La persona quiere agendar: se le avisa a Dayana para que ella agende. */
  bookingRequest: { service: string; when: string | null; note: string } | null;
  /** No hace falta contestar (le está respondiendo a Dayana, solo agradece): por qué. */
  noReply: string | null;
  model: string;
  /** `cachedTokens`: de la entrada, lo que Gemini ya tenía en su caché (cobra el 10 %). */
  usage: { inputTokens?: number; outputTokens?: number; cachedTokens?: number };
};

export type TranscriptLine = {
  direction: "INBOUND" | "OUTBOUND";
  body: string | null;
  /** «imagen», «audio»… si trae adjunto. */
  attachment?: string | null;
  isAutoReply?: boolean;
  /** De dónde salió un mensaje nuestro (`bulk:…`, `approval`, `recordatorio:…`): Dayana a mano no lleva. */
  source?: string | null;
  clientKey?: string | null;
  /** Cuándo se escribió: marca los días en la conversación. */
  sentAt?: Date;
  /** Viene del historial importado del celular (no llegó en vivo). */
  imported?: boolean;
};

/**
 * ¿Persona nueva o ya hay conversación? Nueva: no está en el CRM y, antes de
 * lo que acaba de escribir, casi no había hablado (un «gracias» a una
 * invitación no cuenta como conversación).
 */
export const chatSituation = (transcript: TranscriptLine[], inCrm: boolean): string => {
  let i = transcript.length;
  while (i > 0 && transcript[i - 1].direction === "INBOUND") i--;
  const priorInbound = transcript.slice(0, i).filter((m) => m.direction === "INBOUND").length;
  return !inCrm && priorInbound < 2
    ? "PERSONA NUEVA (no hay conversación previa con ella)."
    : "PERSONA CON CONVERSACIÓN PREVIA: lee el hilo antes de contestar.";
};

/** Pista del país por el número (no reemplaza preguntarlo). */
const countryHint = (phone: string): string | null => {
  const iso = inferLocaleFromPhone(`+${phone}`, "CO")?.countryIso;
  return iso
    ? `El número es de ${countryName(iso)}, pero la persona puede estar en otro país: confírmalo preguntando.`
    : null;
};

/** La conversación con un separador por día, para que la IA sepa cuándo pasó cada cosa. */
const transcriptText = (lines: TranscriptLine[], timezone: string): string => {
  const day = (d: Date) =>
    new Intl.DateTimeFormat("es-CO", { timeZone: timezone, weekday: "long", day: "numeric", month: "long" }).format(d);
  const out: string[] = [];
  let lastDay = "";
  let inImport = false;
  for (const m of lines) {
    // El historial importado va marcado: es pasado real, pero de antes del CRM.
    if (Boolean(m.imported) !== inImport) {
      inImport = Boolean(m.imported);
      out.push(inImport ? "— (historial importado del celular) —" : "— (desde aquí, mensajes en vivo) —");
    }
    if (m.sentAt) {
      const d = day(m.sentAt);
      if (d !== lastDay) {
        out.push(`— ${d} —`);
        lastDay = d;
      }
    }
    out.push(describeLine(m));
  }
  return out.join("\n");
};

/** «CONVERSACIÓN (últimos N mensajes, desde …)»: lo que de verdad lee la IA. */
const transcriptHeader = (lines: TranscriptLine[], timezone: string): string => {
  const first = lines.find((l) => l.sentAt)?.sentAt;
  const since = first
    ? `, desde el ${new Intl.DateTimeFormat("es-CO", { timeZone: timezone, day: "numeric", month: "long", year: "numeric" }).format(first)}`
    : "";
  return `CONVERSACIÓN (últimos ${lines.length} mensajes${since}; lo último abajo)`;
};

/**
 * El modelo a veces escribe en Markdown; WhatsApp usa *un* asterisco para
 * negrita. Y Dayana nunca dice «De nada»: dice «Con gusto».
 */
export const toWhatsAppFormat = (text: string): string =>
  withDayanaWording(
    text
      .trim()
      .replace(/\*\*(.+?)\*\*/g, "*$1*")
      .replace(/__(.+?)__/g, "_$1_")
      .replace(/^#{1,6}\s+/gm, "")
  );

export const modelId = () => process.env.GEMINI_MODEL?.trim() || "gemini-3.5-flash";

const google = geminiProvider();

/** Lo único que la IA puede afirmar: sale del CRM en cada respuesta. */
/** «Llamada gratis de 15 minutos», «la llamada gratis», «consulta gratuita». */
const FREE_CALL_SERVICE = /gratis|gratuit|15\s*min/i;
/** Lo que pide para ya: «hoy», «hoy mismo», «ahora», «esta tarde». */
const SOON_WORDS = /\bhoy\b|\bahora\b|ya mismo|en un rato|esta (tarde|noche|mañana)/i;

/** La portada del sitio («dayanabeltran.com»): un enlace a ella nunca es inventado. */
const siteHosts = (): string[] => {
  try {
    return [new URL(getSiteUrl()).host.toLowerCase().replace(/^www\./, "")];
  } catch {
    return [];
  }
};

export const businessFacts = async (
  config: WhatsAppAiConfig,
  /**
   * `noFreeCall`: ya fue clienta, ya tuvo la llamada o está por revisar: no
   * agenda la llamada gratis. `guest`: solo se inscribió al evento gratuito y
   * no ha pedido nada personal: tampoco (`webinar-guest.ts`).
   */
  opts: { noFreeCall?: boolean; guest?: boolean } = {}
): Promise<string> => {
  const site = getSiteUrl();
  const [products, workshops, events, magnets] = await Promise.all([
    prisma.product.findMany({
      // Misma regla que `isSellable` (lib/plans-from-db.ts).
      where: {
        isActive: true,
        OR: [{ isCourseContent: false }, { sellsStandalone: true }],
      },
      orderBy: { sortOrder: "asc" },
      select: {
        title: true,
        sessionsLabel: true,
      },
      take: 12,
    }),
    prisma.workshopEdition.findMany({
      where: {
        OR: [
          { status: "OPEN" },
          { status: { not: "DRAFT" }, startsAt: { gte: new Date(Date.now() - 24 * 3600_000) } },
        ],
      },
      orderBy: { startsAt: "asc" },
      take: 5,
      select: {
        title: true,
        slug: true,
        status: true,
        startsAt: true,
        dateLabel: true,
        scheduleLabel: true,
        cardSummary: true,
      },
    }),
    prisma.freeWebinar.findMany({
      where: { isActive: true },
      orderBy: { startsAt: "desc" },
      take: 3,
      select: {
        headline: true,
        subheadline: true,
        eventLabel: true,
        locationLabel: true,
        startsAt: true,
        startsAtHasTime: true,
        endedAt: true,
      },
    }),
    prisma.keywordMagnet.findMany({
      where: { isActive: true },
      select: { label: true, title: true, keyword: true },
      take: 6,
    }),
  ]);

  const lines: string[] = [
    `Negocio: ${BRAND.name}, ${BRAND.tagline}. Sitio: ${site}`,
    "",
    // Sin precios: los valores solo los da Dayana en la llamada.
    "PROCESOS QUE OFRECE DAYANA (los valores NO se dan por chat: los explica Dayana en la llamada gratis):",
    ...products.map((p) => `- ${p.title}${p.sessionsLabel ? ` (${p.sessionsLabel})` : ""}`),
    "",
    `Cuestionario gratis (3 min, dice qué proceso le sirve): ${site}/terapias/empezar`,
  ];

  if (config.salesFlow.enabled && config.booking.enabled && opts.guest && !opts.noFreeCall) {
    lines.push(
      "",
      "AGENDAR: esta persona solo se inscribió al evento gratuito y no ha pedido nada personal: no le ofrezcas la llamada gratis ni horas (mira INSCRITA EN UN EVENTO GRATUITO)."
    );
  } else if (config.salesFlow.enabled && config.booking.enabled && opts.noFreeCall) {
    // Sin las herramientas de la llamada gratis (16-oct: Valentina, «por
    // revisar», terminó «agendando» con request_booking para «hoy mismo»).
    lines.push(
      "",
      "AGENDAR: esta persona no agenda la llamada gratis (ya fue clienta, ya la tuvo o está por revisar): no se la ofrezcas. Si quiere una sesión o retomar su proceso, usa request_booking: Dayana revisa su agenda y le confirma por aquí, sin que tú prometas día ni hora."
    );
  } else if (config.salesFlow.enabled && config.booking.enabled) {
    lines.push(
      "",
      "AGENDAR LA LLAMADA GRATIS: usa offer_free_call_slots (horas reales del calendario de Dayana, en la hora de la persona y la de Colombia: primero hoy o mañana si hay espacio, luego los días que Dayana prefiere) y, cuando elija, book_free_call. Si la persona dice cuándo puede o que no puede esos días, vuelve a buscar con eso (dias / noPuede / franja / desde). Nunca envíes enlaces de agenda.",
      "La llamada gratis dura 15 minutos, no tiene costo ni compromiso, y Dayana llama por WhatsApp a este número."
    );
  } else if (!config.booking.aiSchedules) {
    lines.push(
      "",
      "AGENDAR: tú no buscas horas ni agendas. Pregúntale a la persona qué día y hora le quedan bien y usa request_booking: Dayana recibe el aviso, agenda y le confirma. Nunca envíes enlaces de agenda.",
      "La llamada gratis dura 15 minutos."
    );
  } else if (config.booking.enabled) {
    lines.push(
      "",
      "CITAS QUE PUEDES AGENDAR TÚ MISMA en el Google Calendar de Dayana (usa check_availability y book_appointment; nunca envíes enlaces de agenda):",
      ...config.booking.services.map((s) => `- ${s.name}: ${s.minutes} minutos`),
      config.booking.addMeet
        ? "Las citas son por Google Meet; el enlace sale al agendar."
        : ""
    );
  } else if (config.bookingUrl) {
    lines.push("", `Para AGENDAR (ella elige día y hora ahí mismo): ${config.bookingUrl}`);
  } else {
    lines.push("", "AGENDAR: no agendas tú; las citas las coordina Dayana (escala).");
  }

  const when = (d: Date | null, withTime = true) =>
    d
      ? `${new Intl.DateTimeFormat("es-CO", { timeZone: "America/Bogota", weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(d)}${
          withTime ? `, ${new Intl.DateTimeFormat("es-CO", { timeZone: "America/Bogota", hour: "numeric", minute: "2-digit" }).format(d)} hora de Colombia` : ""
        }`
      : null;
  const now = Date.now();

  lines.push("", "TALLERES:");
  if (workshops.length === 0) {
    lines.push("- No hay ningún taller abierto ni programado ahora mismo. Dayana anuncia los próximos por aquí y en sus redes.");
  }
  for (const w of workshops) {
    const date = w.dateLabel || when(w.startsAt);
    lines.push(
      `- ${w.title}${date ? ` — ${date}` : ""}${w.scheduleLabel ? ` (${w.scheduleLabel})` : ""}${
        w.status === "OPEN" ? " — INSCRIPCIONES ABIERTAS" : ` — ${w.status === "CLOSED" ? "inscripciones cerradas" : "próximamente"}`
      }. Página (ahí está toda la información): ${site}/taller-virtual/${w.slug}${w.cardSummary ? `\n  De qué trata: ${w.cardSummary}` : ""}`
    );
  }

  lines.push("", "EVENTOS GRATUITOS (masterclass, webinars):");
  const upcoming = events.filter((e) => !e.endedAt && (!e.startsAt || e.startsAt.getTime() > now - 3 * 3600_000));
  const past = events.filter((e) => !upcoming.includes(e));
  if (upcoming.length === 0) {
    lines.push("- No hay ningún evento gratuito próximo anunciado.");
  }
  for (const e of upcoming) {
    lines.push(
      `- ${e.eventLabel}: «${e.headline}»${e.subheadline ? ` — ${e.subheadline}` : ""}. Cuándo: ${
        when(e.startsAt, e.startsAtHasTime) ?? "fecha por anunciar"
      }. Dónde: ${e.locationLabel}. Es gratis. Inscripción: ${site}/eventos-gratuitos`
    );
  }
  for (const e of past) {
    lines.push(
      `- El último fue «${e.headline}» (${e.eventLabel}) el ${when(e.startsAt, false) ?? "hace poco"}; ya pasó. El próximo se anuncia por aquí y en las redes de Dayana.`
    );
  }

  if (magnets.length > 0) {
    lines.push(
      "",
      "MATERIALES GRATIS por palabra clave:",
      ...magnets.map((m) => `- ${m.label}: ${m.title} → ${site}/material/${m.keyword}`)
    );
  }
  return lines.filter((l) => l !== undefined).join("\n");
};

/** Lo que el CRM sabe de la persona, para contestar con continuidad. */
export const clientContext = async (
  contactId: string | null,
  /** Número del chat: las citas se encuentran también sin contacto en el CRM. */
  phone?: string | null,
  /** Mensajes en su chat: con conversación no es «primera vez que escribe». */
  opts: { messages?: number } = {}
): Promise<string | null> => {
  const contact = contactId
    ? await prisma.contact.findUnique({
        where: { id: contactId },
        select: {
          firstName: true,
          lastName: true,
          enrollments: {
            where: { status: { in: ["ACTIVE", "COMPLETED", "PENDING_PAYMENT", "LEAD"] } },
            orderBy: { createdAt: "desc" },
            take: 5,
            select: {
              status: true,
              sessionsTotal: true,
              sessionsUsed: true,
              paidUntil: true,
              createdAt: true,
              product: { select: { title: true } },
            },
          },
          _count: { select: { diagnostics: true } },
        },
      })
    : null;
  const { next, last } = await appointmentsFor({ contactId, phone }).catch(() => ({ next: null, last: null }));
  const events = await registeredFreeEvents(contactId, phone).catch(() => []);
  if (!contact && !next && !last && events.length === 0) return null;

  const tz = await getOperationalTimezone().catch(() => "America/Bogota");
  const when = (d: Date) =>
    new Intl.DateTimeFormat("es-CO", { timeZone: tz, weekday: "long", day: "numeric", month: "long", hour: "numeric", minute: "2-digit" }).format(d);
  const enrollments = contact?.enrollments ?? [];
  const stage = contactStage({
    enrollments: enrollments.map((e) => ({ status: e.status, sessionsUsed: e.sessionsUsed, sessionsTotal: e.sessionsTotal, product: e.product.title })),
    nextAppointment: next ? { startsAt: next.startsAt, endsAt: next.endsAt, sessionsLabel: next.sessionsLabel } : null,
    lastAppointment: last ? { startsAt: last.startsAt } : null,
    hasDiagnostic: (contact?._count.diagnostics ?? 0) > 0,
    messages: opts.messages,
  });

  const lines: string[] = [];
  if (contact) lines.push(`Nombre en el CRM: ${personFullName([contact.firstName, contact.lastName].filter(Boolean).join(" ")) ?? "sin nombre (el del contacto no es un nombre de persona)"} (cómo llamarla: mira NOMBRE)`);
  lines.push(`Etapa: ${stage.label}`);
  if (next) {
    lines.push(
      `Próxima cita: ${when(next.startsAt)}${isFreeCallAppointment(next) ? " (llamada gratis)" : next.sessionsLabel && next.sessionsLabel !== "0/0" ? ` (sesión ${next.sessionsLabel})` : " (sesión)"}${next.confirmedAt ? " · ya confirmó" : next.reminderSentAt ? " · se le mandó el recordatorio, aún no confirma" : ""}. Si la persona confirma («sí», «ahí estaré»), usa confirm_appointment.`
    );
  }
  if (last) lines.push(`Última cita: ${when(last.startsAt)}.`);
  const STATUS: Record<string, string> = {
    ACTIVE: "activo",
    COMPLETED: "terminado",
    PENDING_PAYMENT: "pendiente de pago",
    LEAD: "interesada",
  };
  if (contact) {
    if (!enrollments.some((e) => e.status === "ACTIVE" || e.status === "COMPLETED")) lines.push("Todavía no ha comprado nada.");
    const diagnostic = contactId ? await diagnosticContextFor(contactId).catch(() => null) : null;
    if (diagnostic) lines.push(diagnostic);
    for (const e of enrollments) {
      const sessions = e.sessionsTotal != null ? ` · sesiones ${e.sessionsUsed} de ${e.sessionsTotal}` : "";
      const until = e.paidUntil ? ` · acceso hasta ${e.paidUntil.toLocaleDateString("es-CO")}` : "";
      lines.push(`- ${e.product.title}: ${STATUS[e.status] ?? e.status}${sessions}${until} (desde ${e.createdAt.toLocaleDateString("es-CO")})`);
    }
  }
  lines.push(...registeredEventLines(events));
  return lines.join("\n");
};

/**
 * Sus inscripciones a eventos gratuitos en pie (abiertos o cerrados, sin
 * terminar). Si el chat no está ligado a un contacto, se busca por su número:
 * quien se inscribe en la web queda como contacto aunque el chat no lo sepa.
 */
const registeredFreeEvents = async (contactId: string | null, phone?: string | null): Promise<RegisteredFreeEvent[]> => {
  const id = await registrantId(contactId, phone);
  if (!id) return [];
  const rows = await prisma.webinarRegistration.findMany({
    where: { contactId: id, webinar: { status: { in: ["OPEN", "CLOSED"] }, endedAt: null } },
    orderBy: { createdAt: "desc" },
    take: 3,
    select: {
      webinar: { select: { eventLabel: true, headline: true, startsAt: true, startsAtHasTime: true, meetUrl: true } },
    },
  });
  return rows.map((r) => r.webinar);
};

/** Lo que contestan las herramientas de la llamada gratis a quien solo se inscribió al evento. */
const GUEST_NO_FREE_CALL =
  "Esta persona solo se inscribió al evento gratuito y no ha pedido nada personal: no le agendes nada ni le ofrezcas horas. Mira INSCRITA EN UN EVENTO GRATUITO.";

/** El contacto del chat, o el que tiene su número (quien se inscribe en la web queda como contacto). */
const registrantId = async (contactId: string | null, phone?: string | null): Promise<string | null> => {
  if (contactId) return contactId;
  const phoneE164 = phone ? phoneFromWhatsAppId(phone)?.phoneE164 : null;
  if (!phoneE164) return null;
  const found = await prisma.contact.findUnique({ where: { phoneE164 }, select: { id: true } });
  return found?.id ?? null;
};

/**
 * El evento gratuito en el que se inscribió y que todavía cuenta (no ha
 * empezado o empezó hace menos de una semana: `guestEventCounts`), el más
 * cercano. Para `BrainInput.freeEvent`.
 *
 * Quien hizo la autoevaluación (el cuestionario de qué proceso le sirve) no:
 * buscó un proceso, y el mensaje de la autoevaluación le dijo que Dayana le
 * escribe (Guada, Magali: autoevaluación y luego el webinar).
 */
export const guestFreeEvent = async (contactId: string | null, phone?: string | null, now = new Date()): Promise<GuestEvent | null> => {
  const id = await registrantId(contactId, phone);
  if (!id) return null;
  if ((await prisma.diagnostic.count({ where: { contactId: id, completedAt: { not: null } } })) > 0) return null;
  // Sin `endedAt: null` (a diferencia de `registeredFreeEvents`): el evento
  // se cierra ~3 h después de empezar y la semana siguiente sigue contando
  // (agradecer, sin la llamada).
  const rows = await prisma.webinarRegistration.findMany({
    where: {
      contactId: id,
      webinar: {
        status: { in: ["OPEN", "CLOSED", "COMPLETED"] },
        OR: [{ startsAt: { gte: new Date(now.getTime() - 7 * 24 * 3600_000) } }, { startsAt: null, endedAt: null }],
      },
    },
    orderBy: { webinar: { startsAt: "desc" } },
    take: 5,
    select: { webinar: { select: { eventLabel: true, headline: true, startsAt: true, startsAtHasTime: true } } },
  });
  const events = rows.map((r) => r.webinar).filter((e) => guestEventCounts(e, now.getTime()));
  // El que viene primero; si ya pasaron todos, el último.
  const upcoming = events.filter((e) => !e.startsAt || e.startsAt > now).sort((a, b) => (a.startsAt?.getTime() ?? Infinity) - (b.startsAt?.getTime() ?? Infinity));
  const past = events.filter((e) => e.startsAt && e.startsAt <= now).sort((a, b) => b.startsAt!.getTime() - a.startsAt!.getTime());
  return upcoming[0] ?? past[0] ?? null;
};

const IDENTITY: Record<WhatsAppAiConfig["identity"], string> = {
  assistant:
    "Escribes DE PARTE de Dayana, no eres ella: habla de Dayana en tercera persona («Dayana te responde», «ella revisa»). No te presentes como robot salvo que te lo pregunten directamente; si te lo preguntan, dilo con naturalidad.",
  owner:
    "Escribes en primera persona, con la voz de Dayana, porque es su número. Si la persona pregunta si habla con un robot o una IA, no lo niegues: di con naturalidad que es una respuesta automática y escala.",
};

/** Solo si la IA agenda sola (booking.aiSchedules): cómo busca y propone horas. */
const aiBookingRule = (config: WhatsAppAiConfig): string =>
  `- AGENDAS tú misma en el Google Calendar de Dayana (nunca mandes enlaces para que agende sola): usa check_availability con la duración del servicio${
    config.booking.approveSlots
      ? " y luego offer_times con 2 o 3 opciones: Dayana las aprueba antes de que salgan, y tu mensaje lleva {{HORARIOS}} donde van (no las escribas tú). Cuando la persona elija una de las horas que ya se le enviaron,"
      : " y ofrece 2 o 3 opciones concretas. Cuando elija,"
  } CONFIRMA repitiendo servicio, día y hora («¿Te agendo la consulta el jueves 25 a las 3:00 p. m.?»). Solo con su «sí», usa book_appointment y comparte día, hora y el enlace de Meet. Si no sabes su nombre, pídeselo antes de agendar. Las horas son de Colombia; si el número no es de Colombia (+57), aclara «hora de Colombia».
`;

/** Persona nueva y con conversación previa, antes del flujo de venta (`salesFlow` apagado). */
const LEGACY_LEAD_RULES = `- PERSONA NUEVA (mira SITUACIÓN DEL CHAT, más abajo):
  · Primer mensaje: «Hola [nombre], te bendigo. Cuéntame, ¿cómo estás?».
  · Al inicio (en el primer o el segundo mensaje, una sola vez) pregúntale desde qué país escribe: «¿Desde qué país me escribes?». En México, Estados Unidos, Brasil, Canadá, España, Argentina o Chile pregunta también la ciudad (tienen varias horas). Cuando lo diga, usa save_country. Si ya lo dijo en la conversación, no lo vuelvas a preguntar.
  · Si cuenta lo que le pasa o lo que quiere («tengo ansiedad», «quiero encontrar pareja», «necesito ayuda emocional», «me siento estancada, bloqueada»…), no la interrogues: refleja en una frase lo que siente y pregúntale «¿Cuánto tiempo más quieres seguir así?», o invítala directo: «Si quieres soltarlo, podemos agendar una llamada gratuita de 15 minutos con Dayana. Dime qué día y hora te quedan bien.»
  · Si quiere agendar o ya dijo un día u hora: usa request_booking (Dayana recibe el aviso y le confirma la hora).
  · Si dice que no puede, que no quiere, o habla de otra cosa: no insistas. Algo como: «Listo, perfecto. Entonces quedamos en contacto; si necesitas información o algo de mí, me escribes por aquí.»
- PERSONA CON CONVERSACIÓN PREVIA: lee el hilo y entiende qué pide ahora. Si quiere agendar (una llamada o una sesión), usa request_booking. Si quiere cambiar o cancelar una cita que ya tiene, escala con category=reschedule. Si puedes responder con los DATOS y lo que ya se habló, responde corto. Si no sabes qué decir, escala con category=unknown.
`;

const CLINICAL_LEGACY =
  "- category=clinical: cuenta un dolor emocional fuerte o pide ayuda psicológica (severity=normal). Nunca hables de líneas de emergencia ni de urgencias.";
const CLINICAL_SALES =
  "- category=clinical: casi nunca, siempre severity=normal. Lo que cuenta de su vida (tristeza, ansiedad, duelo, problemas…) no se escala: una frase de apoyo y el siguiente paso (la llamada gratis, o el pago si ya la tuvo). Nunca hables de líneas de emergencia ni de urgencias.";

/** Cuándo y cómo se comparten las formas de pago y se reciben los comprobantes. */
const paymentRules = (config: WhatsAppAiConfig): string => {
  const methods = paymentMethodsForPrompt(config);
  const lines = ["PAGOS (pagos por fuera de la web: transferencia, Western Union…):"];
  if (methods || config.payments.sendLinks) {
    lines.push(
      `- Si quiere pagar o pide cómo pagar, las cuentas, los datos o el enlace: ${
        config.payments.sendLinks ? "si Dayana le creó un enlace de pago, mándalo con send_payment_link; si no hay, " : ""
      }${
        methods
          ? "usa send_payment_info con la forma de pago que le corresponde (mira a quién va cada una; si no sabes desde qué país paga, pregúntalo primero)"
          : "dile que Dayana le comparte los datos y escala con category=payment"
      }. Tu mensaje es corto y termina pidiéndole el comprobante («Claro, te comparto los datos para el pago. Cuando lo hagas, me mandas el comprobante por aquí para que Dayana lo revise:»): los datos los pega el sistema debajo, tal cual. Nunca escribas tú un número de cuenta, un titular ni un enlace.`,
      "- Si pide una forma de pago que no está en la lista (p. ej. Global66, Remitly, PayPal): dile que Dayana le comparte esos datos y escala con category=payment."
    );
  } else {
    lines.push("- Si quiere pagar o pide los datos de pago: dile que Dayana se los comparte y escala con category=payment.");
  }
  if (config.payments.receipts) {
    lines.push(
      "- Si manda un comprobante, una captura de la transferencia o dice que ya pagó (MIRA las imágenes adjuntas): usa register_payment_receipt con lo que leas en él y contesta corto, por ejemplo «Recibido, [nombre]. Ya le aviso a Dayana para que lo revise y te confirmamos tu sesión.» (di lo que pagó: la sesión, el proceso, el curso o el taller; si no lo sabes, «te confirmamos»). Nunca confirmes tú el pago: lo confirma Dayana.",
      "- Ese aviso se da UNA vez por comprobante. Si ya le dijiste que Dayana lo revisa y la persona agrega algo (para qué es el pago, se disculpa por la demora, agradece): no repitas que Dayana lo revisa. Si trae un dato nuevo del pago, complétalo con register_payment_receipt; contesta solo algo corto y cálido («Con gusto, [nombre] 🙏», «No te preocupes 🙏»).",
      "- Si ves un problema (transferencia rechazada o pendiente, otra cuenta u otro titular, un monto que no cuadra, la captura no se lee): ayúdale con calma a ver qué pasó con lo que ves (si fue a otra cuenta, compártele los datos correctos con send_payment_info), regístralo igual con register_payment_receipt y su `problem`, y dile que Dayana ya está informada y lo están revisando."
    );
  } else {
    lines.push("- Si dice que ya pagó o manda un comprobante: nunca lo confirmes; escala con category=payment.");
  }
  return `${lines.join("\n")}\n`;
};

/** Con una clienta (la atiende Dayana), la IA solo ayuda con pagos. */
const CLIENT_PAYMENT_MODE = `ESTA PERSONA YA ES CLIENTA DE DAYANA y la atiende ella. Tú SOLO ayudas con pagos:
- Si pide datos de pago, las cuentas o el enlace: compártelos (PAGOS) con un mensaje corto.
- Si manda un comprobante o dice que pagó: register_payment_receipt y el mensaje de recibido.
- Para CUALQUIER otra cosa: llama a escalate con category=other y SIN holdingReply (Dayana le contesta).`;

// Sin la hora: va en el prompt (AHORA). Así las reglas son iguales en cada
// llamada y Gemini las cobra al 10 % desde su caché (19-oct: con la hora aquí
// solo reutilizaba las llamadas del mismo minuto).
const systemPrompt = (
  config: WhatsAppAiConfig,
  opts: { salesFlow: boolean; autoBook: boolean; clientMode?: boolean } = { salesFlow: false, autoBook: false }
): string => {
  const leadRules = opts.salesFlow ? salesFlowRules(config, { autoBook: opts.autoBook }) : LEGACY_LEAD_RULES;
  const clinicalRule = opts.salesFlow ? CLINICAL_SALES : CLINICAL_LEGACY;
  const parts = [
    `Contestas el WhatsApp de ${BRAND.name}.

REGLA Nº 1 — PRECIOS: NUNCA escribas un precio, valor, monto, tarifa, costo ni descuento, aunque la persona insista, aunque lo veas en la conversación o en un ejemplo. Los valores SOLO los da Dayana, en la llamada. Si pregunta cuánto cuesta: dile con calidez que cada proceso se ajusta a lo que la persona necesita y que Dayana le explica las opciones y los valores en la consulta gratis de 15 minutos, y ofrécele agendarla (si ya tuvo la llamada: Dayana se lo confirma; escala con category=payment). Las FORMAS DE PAGO sí las puedes dar, pero solo con sus herramientas (abajo, PAGOS).

TONO: amable y profesional: cercana pero seria, respetuosa y clara, en español, de tú, mensajes cortos (2 o 3 frases). «Te bendigo» para saludar. Llama a la persona por su nombre si lo sabes (mira NOMBRE, más abajo). NUNCA uses apodos cariñosos («querida», «querido», «cariño», «mi amor», «hermosa», «mi bella», «linda», «mi reina», «corazón», «amiga»…) ni corazones. Nada de exageraciones, jerga ni muchos emojis. Las horas siempre con a. m./p. m. («6:45 p. m.»), nunca en formato de 24 horas («18:45»).
NUNCA escribas: «¿Qué te trae por aquí?», «Qué alegría tenerte por aquí», «¿Hay algo más en lo que te pueda ayudar?», «De nada» (di «Con gusto»).
Imita la forma de escribir de Dayana (sus ejemplos y su guía de estilo, más abajo) sin salirte de este tono.

La fecha y la hora de ahora están en AHORA (al principio de los datos, abajo).

Cómo conversas (así trabaja Dayana):
- Género: NO adivines si es hombre o mujer (ni por el nombre, ni por la foto, ni por el tema). Usa femenino o masculino solo si la persona ya habló de sí con género en la conversación («estoy cansada», «soy muy desconfiado», «estoy atenta») y entonces respétalo siempre. Mientras no lo sepas, escribe sin género: «te doy la bienvenida» (no «bienvenida/o»), «cuando quieras» o «cuando tengas el momento» (no «cuando estés lista/o»), «tu llamada quedó para el jueves» (no «quedaste agendada/o»), «estate pendiente del teléfono» (no «pendiente y lista»), «gracias por tu interés» (no «interesada/o»).
- Saluda solo en tu primer mensaje de la conversación; después sigue la charla sin volver a decir «Hola» ni repetir el apodo en cada respuesta.
${leadRules}- Primero se agenda la llamada gratis; en esa llamada Dayana habla de procesos y valores. Tú nunca das precios (REGLA Nº 1).
- Cuando te agradezcan, di «Con gusto» (nunca «De nada»).
${config.booking.aiSchedules ? aiBookingRule(config) : ""}- Con clientas que ya conocen a Dayana, usa la CONVERSACIÓN, la MEMORIA y CLIENTA EN EL CRM para dar continuidad (su próxima sesión, su paquete) sin preguntar lo que ya se habló.
- Talleres, webinars, masterclass y eventos gratuitos: tú SÍ sabes cuáles hay, están en los DATOS (TALLERES y EVENTOS GRATUITOS). Si preguntan, di cuál hay, cuándo, cómo es y comparte el enlace de inscripción (de un taller no: pregúntale si separa su cupo de una vez con el enlace de pago, que mandas con send_workshop_link, o agenda primero una llamada con Dayana). Si la persona YA SE INSCRIBIÓ (lo dice CLIENTA EN EL CRM) y pide el enlace, dale el de la reunión de Google Meet que está ahí, tal cual; nunca la página de inscripción. Si no hay ninguno próximo, dilo con naturalidad, cuéntale que Dayana los anuncia por aquí y ofrécele la consulta gratis de 15 minutos. Nunca le preguntes a la persona qué eventos hay ni le digas que no sabes.
- Grabaciones y grupos: los eventos gratuitos (webinars, masterclasses) NO se graban: si preguntan por la grabación de uno, dile con calidez que no queda grabado: «te esperamos en vivo» (o en el próximo). Nunca digas que hay o habrá una grabación, que se la mandas, que algo está «en el grupo» ni que la persona está en un grupo: quien no ha pagado no tiene grabaciones ni grupo de clases. Si pregunta por grabaciones de clases de un curso o taller, escala con category=unknown (Dayana sabe si pagó y dónde están). Si agradece «por aceptarme» o «en su grupo», contesta solo algo corto como «Con gusto 🙏», sin hablar de grupos (ni que está ni que no está, ni que no hay) y sin ofrecerle nada más en ese mensaje.
- Si dudas cómo lo diría Dayana, usa search_past_chats.

${paymentRules(config)}
${communityRules(config)}${opts.clientMode ? "" : urgentSessionRules(config)}
Llama a escalate cuando (la persona nunca se queda sin respuesta: en holdingReply escribe el aviso corto que recibe ahora, p. ej. «Déjame consultarlo con Dayana y te confirmo por aquí»):
- category=payment: insiste en saber el precio, pide un descuento, un reembolso o una factura, o reclama un cobro que no reconoce.
- category=unknown: pregunta algo que no está en los DATOS ni en la conversación, o no entiendes el mensaje (una imagen que no sabes interpretar, un audio marcado «(inaudible)»).
- Las fotos y stickers que mandó la persona van adjuntos como imágenes: míralos y responde a lo que muestran (una captura de un horario, una foto de algo que le pasa, un sticker de cariño…). Nunca digas que no puedes ver imágenes. Las notas de voz llegan transcritas con 🎤 delante: léelas como si te las hubiera escrito.
- category=reschedule: quiere cambiar o cancelar una cita ya agendada.
- category=complaint: se queja o está molesta.
${clinicalRule}
- category=other: Dayana prometió algo en la conversación que tú no puedes cumplir con los DATOS.

${IDENTITY[config.identity]}

LÍMITES (amable, pero con límites): nunca prometas que Dayana llama, escribe o atiende «hoy», «ya» o a una hora que no salió de la agenda; nunca digas que una cita quedó confirmada o agendada si no la agendaste con la herramienta; nunca ofrezcas espacios, sesiones ni ayuda gratis aparte de la llamada gratis de 15 minutos (una por persona), ni favores. ${
      !opts.clientMode && urgentSessionPath(config)
        ? "Si piden algo urgente o «para hoy», ofrécele las horas que dé la agenda; si insiste después de eso, sigue SESIÓN URGENTE."
        : "Si piden algo urgente o «para hoy», dile con calidez que le pasas su mensaje a Dayana y que ella le responde por aquí según su agenda."
    } Si una herramienta de agenda falla o no te da horas, no escribas horarios.

Prohibido siempre: dar precios o valores de cualquier tipo, escribir tú un número de cuenta o un enlace de pago (solo con send_payment_info / send_payment_link / send_urgent_session_link), dar consejo clínico o diagnóstico, prometer resultados, inventar fechas, horarios, enlaces, grabaciones o grupos, confirmar tú un pago (lo confirma Dayana), pedir datos de tarjeta o contraseñas, hablar de otra cosa que no sea este negocio.

Tu respuesta final (si no escalas) es EXACTAMENTE el mensaje de WhatsApp que se envía, sin comillas ni explicaciones. Formato de WhatsApp: negrita con *un asterisco*, nunca **dos**, ni títulos con #, ni tablas.`,
  ];
  if (opts.clientMode) parts.unshift(CLIENT_PAYMENT_MODE);
  if (config.styleGuide) {
    parts.push(`CÓMO ESCRIBE DAYANA (imítalo, sin salirte del tono profesional y sin dar precios):\n${softenForPrompt(redactPrices(config.styleGuide))}`);
  }
  if (config.instructions) {
    parts.push(
      `INSTRUCCIONES DE DAYANA (cúmplelas, salvo que choquen con lo prohibido):\n${config.instructions}`
    );
  }
  return parts.join("\n\n");
};

const ASK_NAME =
  "Si en la conversación dijo su nombre («soy Samy»), usa ese. Si no, escribe sin nombre y pregúntale una sola vez, con naturalidad, «¿Con quién tengo el gusto?» (en tu primer o segundo mensaje, o antes de agendar). Si ya se lo preguntaste y no lo dijo, no insistas.";

const NAME_HOW = { said: "lo dijo en el chat", dayana: "así le dice Dayana", form: "lo escribió en su inscripción o en sus datos" } as const;

/**
 * NOMBRE: solo uno seguro (`resolvePersonName`): lo dijo, Dayana le dice así o
 * lo escribió en un formulario. El perfil de WhatsApp solo no basta (Fely
 * Mateo, 18-oct: «Hola Fely» y luego «Felicitas»). Un perfil como «DIOS ES MI
 * PROVEEDOR 🙏» no se usa nunca (la asistente le contestó «Sí, Dios es mi
 * proveedor»). Sin nombre seguro: sin nombre, y se le pregunta.
 */
export const nameLine = (r: NameResolution): string => {
  if (r.kind === "sure") {
    const avoid = r.avoid.length ? ` Nunca la llames ${r.avoid.map((n) => `«${n}»`).join(" ni ")} (otros nombres de su perfil o sus datos).` : "";
    const first = r.first !== r.full ? ` Para saludar, su primer nombre: «${r.first}».` : "";
    return `NOMBRE: se llama ${r.full} (seguro: ${NAME_HOW[r.how]}).${first} Usa SOLO ese nombre.${avoid}`;
  }
  if (r.kind === "unsure") {
    return [
      `NOMBRE: no sabemos con seguridad cómo se llama: su perfil de WhatsApp o sus datos dicen ${r.candidates.map((n) => `«${n}»`).join(" y ")}, pero eso no lo confirma (puede ser un apodo u otra persona). No uses ningún nombre, tampoco ese.`,
      ASK_NAME,
    ].join(" ");
  }
  return [
    "NOMBRE: no sabemos cómo se llama.",
    r.profile ? `Su perfil de WhatsApp dice «${r.profile}», que no es un nombre de persona: NUNCA le llames así ni repitas esa frase.` : null,
    ASK_NAME,
  ]
    .filter(Boolean)
    .join(" ");
};

/** Sin quién escribió cada mensaje de Dayana (vista previa, evaluación): lo que hay en la conversación. */
const nameMessages = (transcript: TranscriptLine[]): NameMessage[] =>
  transcript.map((l) => ({ from: l.direction === "INBOUND" ? "person" : l.isAutoReply ? "assistant" : "dayana", text: l.body ?? "" }));

const examplesBlock = (examples: SimilarExample[]): string | null =>
  examples.length === 0
    ? null
    : [
        "EJEMPLOS REALES de cómo contestó Dayana a mensajes parecidos. Imita su forma. Las fechas, enlaces u ofertas pueden estar viejos (esos datos salen solo de los DATOS) y los precios están borrados: tú nunca das precios.",
        ...examples.map((e, i) => `#${i + 1}\nPERSONA: ${redactPrices(e.clientText)}\nDAYANA: ${softenForPrompt(redactPrices(e.replyText))}`),
      ].join("\n\n");

const describeLine = (m: TranscriptLine): string => {
  const who =
    m.direction === "INBOUND" ? "PERSONA" : m.isAutoReply ? "ASISTENTE" : "DAYANA";
  const body = m.body?.trim();
  const att = m.attachment ? `[${m.attachment}]` : "";
  return `${who}: ${[att, body].filter(Boolean).join(" ") || "(mensaje vacío)"}`;
};

const formatSlot = (iso: string, timezone: string): string => {
  const d = new Date(iso);
  const day = new Intl.DateTimeFormat("es-CO", {
    timeZone: timezone,
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(d);
  return `${day}, ${getTimeLabelInTz(d, timezone)}`;
};

/** Búsqueda literal en lo que Dayana ha escrito (complementa los vectores). */
const searchDayanaReplies = async (query: string): Promise<string[]> => {
  // Solo lo que Dayana escribió contestando en chats de trabajo: ni la IA, ni
  // masivos, ni la familia.
  const rows = await prisma.$queryRaw<{ body: string }[]>(Prisma.sql`
    SELECT m.body FROM conversation_messages m
    JOIN conversations c ON c.id = m.conversation_id
    LEFT JOIN whatsapp_dossiers d ON d.conversation_id = c.id
    WHERE ${humanReplySql} AND m.body IS NOT NULL AND c.channel = 'WHATSAPP'
      AND NOT ${notLearnableChatSql}
      AND to_tsvector('spanish', m.body) @@ plainto_tsquery('spanish', ${query})
    ORDER BY m.sent_at DESC
    LIMIT 5`);
  return rows.map((r) => r.body.slice(0, 500));
};

export type BrainInput = {
  config: WhatsAppAiConfig;
  transcript: TranscriptLine[];
  name: string | null;
  /**
   * Qué nombre es seguro (`resolvePersonName` con el perfil, el contacto y
   * todo el chat). Sin él se deduce de `name` (el perfil) y lo que la IA lee.
   */
  nameInfo?: NameResolution;
  phone: string;
  conversationId: string | null;
  contactId: string | null;
  client: string | null;
  memory: string | null;
  timezone: string;
  /** `preview` no agenda de verdad (botón «Probar», chat con el asistente). */
  mode: "live" | "preview";
  now?: Date;
  /** Las últimas fotos o stickers de la persona: la IA las ve (Gemini). */
  images?: { data: Uint8Array; mediaType: string }[];
  /**
   * «SITUACIÓN DEL CHAT» calculada sobre todo el chat (`situation.ts`). Sin
   * ella se deduce de lo que la IA lee (puede quedarse corto).
   */
  situation?: string | null;
  /**
   * La última lista de horas de la llamada gratis que recibió (de vueltas
   * anteriores, en orden): `book_free_call({ option })` elige de aquí.
   */
  latestOffer?: OfferedSlot[] | null;
  /** Estado de la persona con Dayana (`stage.ts`). */
  stage?: Stage | null;
  /** La ficha de la persona, armada con todo su chat (`dossier.ts`). */
  dossier?: string | null;
  /** Mensajes viejos del mismo chat que tocan lo que acaba de escribir (`context.ts`). */
  olderSnippets?: TranscriptLine[];
  /**
   * Google bloqueó el pedido (PROHIBITED_CONTENT, solo desde producción): la
   * segunda vuelta va sin los ejemplos de otros chats (lo que más cambia entre
   * pedidos; hay respuestas de Dayana sobre abusos), sin ficha ni mensajes viejos.
   */
  slim?: boolean;
  /**
   * La llamada gratis (`salesFlow`): si la asistente puede agendar sola y la
   * zona horaria de la persona, si ya se sabe.
   */
  freeCall?: { autoBook: boolean; personTimezone: string | null };
  /** Es clienta (la atiende Dayana): la IA solo comparte datos de pago y recibe comprobantes. */
  clientMode?: boolean;
  /**
   * El evento gratuito en el que está inscrita (`guestFreeEvent`), si todavía
   * no tiene llamada ni es clienta: mientras no pida nada personal, bienvenida
   * al evento y nada de la llamada gratis (`webinar-guest.ts`).
   */
  freeEvent?: GuestEvent | null;
  /**
   * El taller con inscripciones abiertas (`openWorkshopForAi`). Sin pasarlo se
   * busca; `null` = no hay. Quien pregunta por él recibe la información y la
   * llamada con Dayana para inscribirse (`workshop-interest.ts`).
   */
  workshop?: OpenWorkshop | null;
};

/** Qué tan cerca de lo que pidió quedan las horas que se le ofrecen (`relaxedWishes`). */
const CLOSEST_NOTE: Record<WishStep, string> = {
  exact: "las que pidió",
  same_days: "el mismo día que pidió, a otra hora",
  same_time: "a la hora que pidió, otro día",
  any: "las más cercanas",
};

/** Horas que Dayana ya aprobó para ofrecer en este chat (últimos 14 días). */
export const approvedSlotsFor = async (conversationId: string | null): Promise<string[]> => {
  if (!conversationId) return [];
  const runs = await prisma.whatsAppAiRun.findMany({
    where: { conversationId, status: "APPROVED", queuedAt: { gte: new Date(Date.now() - 14 * 24 * 3600_000) } },
    orderBy: { queuedAt: "desc" },
    take: 20,
    select: { proposal: true },
  });
  const out: string[] = [];
  for (const r of runs) {
    const p = r.proposal as { kind?: string; approvedSlots?: { startIso: string }[] } | null;
    if (p?.kind === "slots") for (const s of p.approvedSlots ?? []) out.push(s.startIso);
  }
  return out;
};

export const think = async (input: BrainInput): Promise<BrainResult> => {
  const now = input.now ?? new Date();
  const { config, timezone } = input;
  const nameInfo = input.nameInfo ?? resolvePersonName({ profile: input.name, messages: nameMessages(input.transcript) });
  const toolCalls: BrainResult["toolCalls"] = [];
  // En un objeto y no en `let`: las tools lo escriben desde closures y TS no
  // ensancharía el tipo de una variable ya estrechada a null.
  const state: {
    outcome: BrainOutcome | null;
    booking: BrainBooking | null;
    stickerUrl: string | null;
    pendingBooking: BrainResult["pendingBooking"];
    pendingPayment: BrainResult["pendingPayment"];
    bookingRequest: BrainResult["bookingRequest"];
    /** `needsCity`: un país con varias horas sin la ciudad (no se le dan horas todavía). */
    country: { iso: string; city: string | null; timezone: string; needsCity?: boolean } | null;
    pendingSlots: BrainResult["pendingSlots"];
    suggestedReply: string | null;
    holdingReply: string | null;
    paymentDetails: string[];
    paymentLink: string | null;
    links: string[];
    urgentSession: BrainResult["urgentSession"];
    receipt: BrainResult["receipt"];
    noReply: string | null;
    slotOffer: BrainResult["slotOffer"];
    bookingNotice: BrainResult["bookingNotice"];
    /** Agendar dijo que ya tiene su llamada o no la pudo mover: no se listan horas. */
    keepsCall: "booked" | "moveFailed" | null;
    silentEscalation: BrainResult["silentEscalation"];
  } = {
    outcome: null,
    booking: null,
    stickerUrl: null,
    pendingBooking: null,
    pendingPayment: null,
    bookingRequest: null,
    country: null,
    pendingSlots: null,
    suggestedReply: null,
    holdingReply: null,
    paymentDetails: [],
    paymentLink: null,
    links: [],
    urgentSession: null,
    receipt: null,
    noReply: null,
    slotOffer: null,
    bookingNotice: null,
    keepsCall: null,
    silentEscalation: null,
  };
  // Las horas que devolvió check_availability en esta vuelta (offer_times solo acepta estas).
  const seenOptions = new Map<string, string>();
  // El flujo de venta (persona nueva → llamada gratis) y las horas de la llamada ofrecidas en esta vuelta.
  // Nunca a quien ya tuvo la llamada, a una clienta (o posible clienta) ni a un chat personal.
  // Ya fue clienta, ya tuvo la llamada o está por revisar: sin llamada gratis.
  // Salvo el taller (dueña, 24-oct: «para inscribirse toca con llamada a
  // Dayana»): quien ya tuvo su llamada o ya fue clienta y pregunta por el taller
  // abierto (en las últimas 24 h) sí puede separarla.
  // Quien ya pagó este taller no es interesada: nada de «inscríbete con la llamada».
  const openWorkshop = input.workshop !== undefined ? input.workshop : await openWorkshopForAi(now).catch(() => null);
  const workshop =
    openWorkshop && !(input.contactId && (await enrolledInWorkshop(input.contactId, openWorkshop.id).catch(() => false))) ? openWorkshop : null;
  // También si le escribimos desde la lista de interesadas (Dayana tocó «Ofrecerle la llamada»).
  const workshopLead = Boolean(workshop) && !input.clientMode && workshopLeadActive(input.transcript, workshop!, now.getTime());
  // La llamada para el taller solo mientras habla de él (no 24 h abierta a cualquier mensaje).
  const workshopFlow = workshopLead && workshopFlowActive(input.transcript, workshop!, now.getTime());
  const noFreeCall =
    Boolean(input.stage && NO_FREE_CALL_STAGES.has(input.stage)) &&
    !(workshopFlow && (input.stage === "tuvo_llamada" || input.stage === "clienta_pasada"));
  const salesOn = config.salesFlow.enabled && config.booking.enabled && !noFreeCall;
  const autoBook = salesOn && Boolean(input.freeCall?.autoBook);
  const offeredNow = new Set<string>();
  const offeredBefore =
    salesOn && input.conversationId ? await offeredFreeCallSlots(input.conversationId, now).catch(() => [] as string[]) : [];
  const personTz = () => state.country?.timezone ?? input.freeCall?.personTimezone ?? null;
  // Ya tiene la llamada gratis: si pide otra hora, se mueve (no se escala).
  const upcomingCall = autoBook && input.conversationId ? await upcomingFreeCall(input.conversationId, config, now).catch(() => null) : null;
  // Solo se inscribió a un evento gratuito y no ha pedido nada personal
  // (dueña, 22-oct): bienvenida al evento, y las herramientas de la llamada
  // gratis contestan que no se agenda. Las reglas del sistema y la lista de
  // herramientas no cambian (caché de Gemini): mandan la línea del prompt y
  // el freno de abajo. Con una llamada ya agendada, no (se la puede mover).
  const guestEvent =
    salesOn &&
    !input.clientMode &&
    !upcomingCall &&
    input.freeEvent &&
    guestEventCounts(input.freeEvent, now.getTime()) &&
    !wantsProcess(input.transcript, now.getTime()) &&
    // Preguntar por el taller es pedir algo (Sergio, 24-oct: inscrito al webinar).
    !workshopLead
      ? input.freeEvent
      : null;

  // Los stickers que Dayana usa de verdad (al menos dos veces), con lo que
  // suele escribir antes de mandarlos.
  const { listDayanaStickers } = await import("./workspace");
  const stickers = (await listDayanaStickers(20).catch(() => [])).filter((s) => s.uses >= 2).slice(0, 12);

  const lastInbound: string[] = [];
  let lastInboundMedia = false;
  for (const m of [...input.transcript].reverse()) {
    if (m.direction !== "INBOUND") break;
    if (m.body?.trim()) lastInbound.unshift(m.body.trim());
    if (m.attachment) lastInboundMedia = true;
  }
  // Pregunta por el taller en lo que escribió ahora («Mi pregunta es, para el 15 de noviembre» + «El taller»: juntos).
  const workshopAskNow = Boolean(workshop) && workshopLead && isWorkshopAsk(lastInbound.join("\n"), workshop!);
  // El enlace de pago del taller (dueña, 25-oct: «que pregunte si para separar su cupo o agendar»).
  const workshopPay = workshop?.payUrl ?? null;
  // Su llamada ya agendada (también sin agenda automática), para decirle que ahí la inscribe Dayana.
  const workshopCall =
    upcomingCall ??
    (workshopAskNow && input.conversationId ? await upcomingFreeCall(input.conversationId, config, now).catch(() => null) : null);
  const upcomingLabelText = workshopCall ? dualZoneLabel(workshopCall.startsAt.toISOString(), personTz() ?? timezone, timezone) : null;
  const examples = config.learning.enabled && !input.slim
    ? await findSimilarExamples(lastInbound.join("\n"), spendLimits(config).examples).catch(
        (e) => {
          console.error("[whatsapp-agent] sin ejemplos", e);
          return [] as SimilarExample[];
        }
      )
    : [];

  const serviceNames = config.booking.services.map((s) => s.name);
  const durationOf = (service: string) =>
    config.booking.services.find(
      (s) => s.name.toLowerCase() === service.toLowerCase()
    )?.minutes ?? config.booking.services[0].minutes;

  const log = (name: string, inputValue: unknown, output: unknown) => {
    toolCalls.push({ tool: name, input: inputValue, output });
    return output;
  };

  // Pagos por fuera de la web: los datos y el enlace los pega el código (nunca el modelo).
  const methods = enabledMethods(config);
  // Lo último antes de lo que escribió la persona lo escribió Dayana: le está respondiendo a ella.
  const toDayana = answeringDayana(input.transcript);
  // Los enlaces de pago que Dayana ya le mandó en el chat (Paola, 21-oct); el
  // último primero. Con varios (Joselyn: 3 y 6 sesiones) se elige con `cual`.
  const chatLinks = config.payments.sendLinks ? dayanaPaymentLinks(input.transcript, now) : [];
  const chatLink = chatLinks[0] ?? null;
  // Y si no fue un enlace: la cuenta, el Nequi o el valor que Dayana le escribió (Carmen, Raquel, 21-oct).
  const chatPayInfo = chatLink ? null : dayanaPaymentInfo(input.transcript, now);
  // En qué va su cierre después de la cotización (`quote-follow-up-rules.ts`): solo en «tuvo la llamada».
  // 30 días y no los del envío (14): la línea no promete seguimientos, le dice
  // a la IA qué contestar a «pago la otra semana» aunque la cotización sea vieja.
  const quoteSit =
    input.stage === "tuvo_llamada" && config.quoteFollowUp.enabled
      ? quoteSituation(
          input.transcript.map((l) => ({ ...l, sentAt: l.sentAt ?? now, media: Boolean(l.attachment) })),
          { now, tz: input.freeCall?.personTimezone ?? timezone, lookbackDays: 30 }
        )
      : null;
  // Elige separar su cupo o habla de pagar el taller («quiero separar mi cupo», «el enlace»,
  // «la primera» tras la pregunta): va el enlace. También si preguntó por el taller en las
  // últimas 24 h y la conversación ya no lo nombra (Sergio, 25-oct: «Es que es respecto al
  // pago» y la IA le dijo que Dayana le explicaba en la llamada), salvo que tenga un pago de
  // su proceso pendiente (el enlace o los datos de Dayana, una cotización) o hable de él.
  const lastOutbound = [...input.transcript].reverse().find((l) => l.direction === "OUTBOUND");
  const processPay = Boolean(chatLink || chatPayInfo || quoteSit || dayanaPaymentInfo(input.transcript, now));
  const saidNow = lastInbound.join("\n");
  // Estuvo en el webinar (los últimos 3 días) y habla de pagar con la promoción que Dayana
  // dio ahí (dueña, 25-oct): con el taller abierto, es la del taller.
  const webinarAt = input.freeEvent?.startsAt?.getTime() ?? null;
  const afterWebinar = webinarAt !== null && webinarAt <= now.getTime() && now.getTime() - webinarAt < 3 * 24 * 3600_000;
  const promoAsk = mentionsPromo(saidNow);
  const workshopSpot =
    Boolean(workshopPay) &&
    !input.clientMode &&
    (workshopAskNow ||
      workshopFlow ||
      ((workshopLead || (afterWebinar && promoAsk)) && !processPay && !aboutOwnProcess(saidNow))) &&
    !lastInboundMedia &&
    wantsWorkshopSpot(saidNow, { afterChoice: isWorkshopChoice(lastOutbound?.body) });
  // Pregunta por una promoción que la IA no conoce: la confirma Dayana, el enlace va ya.
  const workshopPromo = workshopSpot && promoAsk;
  const paymentTools = {
    ...(methods.length > 0
      ? {
          send_payment_info: tool({
            description:
              "Manda, debajo de tu mensaje, los datos de una forma de pago tal como los tiene Dayana (titular, cuenta…). Úsalo cuando la persona quiere pagar o pide cómo pagar o las cuentas. Elige la que le corresponde según a quién va.",
            inputSchema: z.object({
              method: z.enum(methods.map((m) => m.key) as [string, ...string[]]).describe("La clave de la forma de pago."),
            }),
            execute: async ({ method }) => {
              const m = paymentDetails(config, method);
              if (!m) return log("send_payment_info", { method }, { ok: false, reason: "No existe esa forma de pago." });
              // Con un enlace de Dayana (en el chat o creado en el CRM), las cuentas solo si las pide.
              // Un comprobante (a otra cuenta, rechazado…) sí puede necesitar los datos correctos.
              if (config.payments.sendLinks && !state.receipt && !lastInboundMedia && !asksForBankDetails(lastInbound)) {
                const link = chatLink?.url ?? (await activePaymentLinkFor(input.contactId).catch(() => null))?.url ?? null;
                if (!link && chatPayInfo) {
                  return log("send_payment_info", { method }, {
                    ok: false,
                    reason:
                      "Dayana ya le mandó por aquí cómo pagar: no le mandes otras cuentas. Dile que puede hacer el pago con los datos que le envió Dayana y que, cuando lo haga, te mande el comprobante por aquí para que Dayana lo verifique. Otras cuentas solo si las pide (la cuenta, transferir, Western Union…) o si no puede pagar así.",
                  });
                }
                if (link) {
                  return log("send_payment_info", { method }, {
                    ok: false,
                    reason:
                      "Dayana ya le mandó su enlace de pago: no le mandes las cuentas. Usa send_payment_link y dile que puede hacer el pago por el enlace que le envió Dayana y que, cuando lo haga, te mande el comprobante por aquí. Las cuentas solo si las pide (la cuenta, transferir, Nequi, Western Union…) o si el enlace no le sirve.",
                  });
                }
              }
              if (!state.paymentDetails.includes(m.details)) state.paymentDetails.push(m.details);
              return log("send_payment_info", { method }, { ok: true, label: m.label, note: "Los datos van debajo de tu mensaje: no los repitas." });
            },
          }),
        }
      : {}),
    ...(config.payments.sendLinks
      ? {
          send_payment_link: tool({
            description:
              "Manda, debajo de tu mensaje, el enlace de pago personal que Dayana creó para esta persona (si lo hay). Úsalo cuando pide el enlace o quiere pagar lo que acordó con Dayana.",
            inputSchema: z.object({
              cual: z
                .string()
                .optional()
                .describe("Si Dayana le mandó varios enlaces: cuál («paquete de 3 sesiones»), según las notas de Dayana o el chat."),
            }),
            execute: async ({ cual }) => {
              const link = await activePaymentLinkFor(input.contactId).catch(() => null);
              // Sin `cual`, el que nombran las notas de Dayana (Joselyn: primero el de 3).
              const fromChat = pickPaymentLink(chatLinks, cual ?? input.memory);
              if (!link && fromChat) {
                state.paymentLink = fromChat.url;
                return log("send_payment_link", { cual }, {
                  ok: true,
                  product: fromChat.label,
                  note: "Es el enlace que Dayana le mandó por aquí: dile que puede hacer el pago por ese enlace y que, cuando lo haga, te mande el comprobante por aquí. El enlace va debajo de tu mensaje: no lo repitas ni digas el precio.",
                });
              }
              if (!link) {
                return log("send_payment_link", {}, {
                  ok: false,
                  reason: methods.length
                    ? "Dayana no le ha creado un enlace: ofrécele los datos de pago (send_payment_info)."
                    : "Dayana no le ha creado un enlace: dile que Dayana se lo envía y escala con category=payment.",
                });
              }
              state.paymentLink = link.url;
              return log("send_payment_link", {}, { ok: true, product: link.product, note: "El enlace va debajo de tu mensaje: no lo repitas ni digas el precio." });
            },
          }),
        }
      : {}),
    ...(config.payments.receipts
      ? {
          register_payment_receipt: tool({
            description:
              "La persona mandó un comprobante de pago (o dice que ya pagó): queda por confirmar y se le avisa a Dayana. Llena lo que leas en el comprobante; lo que no se vea, déjalo vacío. Después contesta corto que Dayana lo revisa.",
            inputSchema: z.object({
              summary: z.string().max(200).describe("Para Dayana, en una línea: qué es (banco, monto, a nombre de quién)."),
              method: z.string().max(60).optional().describe("Banco o medio: Bancolombia, Western Union, Global66, Remitly, Nequi…"),
              amount: z.number().positive().optional().describe("El monto que se ve, sin símbolos (150000, 80)."),
              currency: z.string().max(3).optional().describe("COP, USD, EUR, MXN…"),
              reference: z.string().max(80).optional().describe("Número de comprobante o referencia, si se ve."),
              paidOn: z.string().max(40).optional().describe("Fecha del pago tal como se ve."),
              payerName: z.string().max(100).optional().describe("Quién pagó, si se ve."),
              problem: z
                .string()
                .max(200)
                .optional()
                .describe("Solo si ves algo raro: transferencia rechazada o pendiente, otra cuenta u otro titular, monto que no cuadra, no se lee."),
              confirmMessage: z
                .string()
                .max(400)
                .optional()
                .describe(
                  "Para DESPUÉS de que Dayana confirme el pago: agradece, dice que el pago quedó confirmado y el siguiente paso, sin montos («Gracias, Ana. Dayana confirmó tu pago ✅ …»). No es el aviso de recibido: nunca «lo revisa» ni «te confirmamos»."
                ),
            }),
            execute: async (args) => {
              state.receipt = {
                summary: args.summary,
                method: args.method ?? null,
                amount: args.amount ?? null,
                currency: args.currency ?? null,
                reference: args.reference ?? null,
                paidOn: args.paidOn ?? null,
                payerName: args.payerName ?? null,
                problem: args.problem ?? null,
                confirmMessage: args.confirmMessage ?? null,
              };
              return log("register_payment_receipt", args, { ok: true, note: "Dayana recibe el aviso. Contesta corto que lo revisa; nunca confirmes el pago." });
            },
          }),
        }
      : {}),
  };

  // La comunidad y lo más económico: el enlace lo pega el código, como los datos de pago.
  const community = communityLink(config);
  const options = affordableOptions(config);
  const urgentPath = input.clientMode ? null : urgentSessionPath(config);
  const addLink = (url: string) => {
    if (!state.links.includes(url)) state.links.push(url);
  };
  const linkTools = {
    // Con el taller abierto la herramienta está para todos (la lista no cambia por chat: caché de Gemini).
    ...(openWorkshop?.payUrl
      ? {
          send_workshop_link: tool({
            description: `Manda, debajo de tu mensaje, el enlace de pago del taller «${openWorkshop.title}» para separar su cupo. Úsalo cuando elige separar su cupo, quiere pagar o inscribirse ya, o pide el enlace del taller. Nunca escribas el enlace ni digas el precio: lo ve en el enlace.`,
            inputSchema: z.object({}),
            execute: async () => {
              if (!workshopPay) return log("send_workshop_link", {}, { ok: false, reason: "Ya pagó este taller: no le mandes el enlace." });
              // Solo a quien habla del taller (no es el enlace de pago de su proceso).
              if (!workshopLead && !workshopSpot) return log("send_workshop_link", {}, { ok: false, reason: "No está hablando del taller: no le mandes este enlace." });
              // Pregunta por el taller y todavía no eligió (eval 25-oct: a «¿el costo del taller?» le mandaba el enlace sin preguntar).
              if (workshopAskNow && !workshopSpot) {
                return log("send_workshop_link", {}, {
                  ok: false,
                  reason: "Todavía no eligió: pregúntale si quiere separar su cupo ya con el enlace de pago o agendar primero una llamada con Dayana.",
                });
              }
              addLink(workshopPay);
              return log("send_workshop_link", {}, { ok: true, note: "El enlace va debajo de tu mensaje: no lo escribas ni digas el precio." });
            },
          }),
        }
      : {}),
    ...(community
      ? {
          send_community_link: tool({
            description: `Manda, debajo de tu mensaje, el enlace para unirse gratis a la comunidad de WhatsApp de Dayana («${config.community.name}»). Úsalo cuando pide entrar a la comunidad o al grupo, o cuando no le alcanza para la terapia.`,
            inputSchema: z.object({}),
            execute: async () => {
              addLink(community);
              return log("send_community_link", {}, { ok: true, note: "El enlace va debajo de tu mensaje: no lo escribas." });
            },
          }),
        }
      : {}),
    ...(options.length > 0
      ? {
          send_affordable_option: tool({
            description:
              "Manda, debajo de tu mensaje, el enlace de una opción más económica que la terapia (p. ej. el curso en vivo en grupo). Úsalo solo cuando a la persona no le alcanza o pide algo más económico. Nunca digas el precio: lo ve en el enlace.",
            inputSchema: z.object({
              option: z.enum(options.map((o) => o.key) as [string, ...string[]]).describe("La clave de la opción."),
            }),
            execute: async ({ option }) => {
              const o = options.find((x) => x.key === option);
              if (!o) return log("send_affordable_option", { option }, { ok: false, reason: "No existe esa opción." });
              addLink(absoluteUrl(o.url));
              return log("send_affordable_option", { option }, { ok: true, label: o.label, note: "El enlace va debajo de tu mensaje: no lo escribas ni digas el precio." });
            },
          }),
        }
      : {}),
    ...(urgentPath
      ? {
          send_urgent_session_link: tool({
            description:
              "Manda, debajo de tu mensaje, el enlace de pago de la sesión privada de 1 hora con Dayana por Google Meet y que, en cuanto pague, Dayana la agenda para hoy o mañana. Solo si insiste en hablar con Dayana hoy o ya: lo pidió, le dijiste que hoy no hay espacio o le ofreciste otros días, y vuelve a pedirlo. Nunca digas el precio.",
            inputSchema: z.object({
              motivo: z.string().max(200).describe("Para Dayana, en una línea: por qué es urgente, con sus palabras."),
            }),
            execute: async ({ motivo }) => {
              const url = absoluteUrl(urgentPath);
              if (urgentLinkSent(input.transcript, url)) {
                return log("send_urgent_session_link", { motivo }, {
                  ok: false,
                  reason: "Ya se lo mandaste: no lo repitas. Recuérdale con calidez que en cuanto pague, Dayana se la agenda.",
                });
              }
              const check = urgencyInsisted(input.transcript);
              if (!check.insisted) {
                return log("send_urgent_session_link", { motivo }, {
                  ok: false,
                  reason: "Todavía no insistió: ofrécele las horas de la llamada gratis (offer_free_call_slots) o pregúntale qué le pasa. La sesión urgente es solo si vuelve a pedir hablar hoy después de eso.",
                });
              }
              addLink(url);
              addLink(urgentSessionAfter(config));
              state.urgentSession = { reason: motivo, asks: check.asks };
              return log("send_urgent_session_link", { motivo }, {
                ok: true,
                note: "El enlace y el siguiente paso van debajo de tu mensaje y Dayana ya recibe el aviso: no escales. Contesta corto, sin escribir el enlace, el precio ni «hoy mismo».",
              });
            },
          }),
        }
      : {}),
  };

  // Las horas de la llamada gratis: la herramienta y, si el modelo no la usó después de un
  // «sí» a la llamada, el código (`acceptedCallWithoutHours`, Moi / Belén / Ana, 21–26 oct).
  type OfferArgs = { dias?: string[]; noPuede?: string[]; franja?: "mañana" | "tarde" | "noche"; desde?: string };
  const offerSlots = async (args: OfferArgs) => {
    if (guestEvent) return log("offer_free_call_slots", args, { error: GUEST_NO_FREE_CALL });
    // Sin zona guardada: la que se deduce del chat y del número (Sophie y
    // «💙💙💜🩷», 16-oct: dijeron «Desde colombia» / «De la CDMX», la IA no
    // guardó el país, la agenda falló y ella inventó horas).
    const inferred = personTz() ? null : inferPersonZone(input.phone, input.transcript);
    if (inferred) {
      state.country = { iso: inferred.iso, city: inferred.city, timezone: inferred.timezone, needsCity: false };
      // En la ficha, como save_country: la próxima vuelta (y el freno de
      // promesas) ya sabe su hora (Raquel, 19-oct, «España» sin guardar).
      if (input.mode === "live" && input.conversationId) {
        await prisma.whatsAppDossier
          .upsert({
            where: { conversationId: input.conversationId },
            create: { conversationId: input.conversationId, countryIso: inferred.iso, timezone: inferred.timezone },
            update: { countryIso: inferred.iso, timezone: inferred.timezone },
          })
          .catch(() => undefined);
      }
    }
    const tz = personTz();
    if (!tz) {
      return log("offer_free_call_slots", {}, {
        error:
          "Aún no tienes su zona horaria. Si ya dijo su país o su ciudad en la conversación («De la CDMX», «soy de Medellín»), usa save_country con eso y vuelve a llamar esta herramienta; si no lo dijo, pregúntaselo («¿Desde qué país me escribes?»). Mientras esta herramienta no te dé horas, NO escribas ningún horario.",
      });
    }
    // México, Estados Unidos, Brasil…: sin la ciudad la hora puede
    // estar mal. Primero la ciudad (un mensaje solo con esa pregunta).
    if (state.country?.needsCity) {
      return log("offer_free_call_slots", {}, {
        error: "Ese país tiene varias horas: tu mensaje ahora es SOLO preguntarle en qué ciudad está (sin horarios). Cuando la diga, save_country con la ciudad y después offer_free_call_slots.",
      });
    }
    try {
      // Una franja que la persona nunca dijo no limita las horas.
      const said = saidPartOfDay(input.transcript.filter((l) => l.direction === "INBOUND").map((l) => l.body));
      const wish = wishFromWords(said ? args : { ...args, franja: undefined }, tz, now);
      const { options, matchedWish, closest } = await offerFreeCallSlotsFor({ config, personTz: tz, dayanaTz: timezone, now, wish });
      if (options.length === 0) {
        return log("offer_free_call_slots", args, {
          error: "No hay horas libres en los próximos días. Dile con calidez que Dayana le escribe para buscar un espacio y escala con category=other.",
        });
      }
      options.forEach((o) => offeredNow.add(new Date(o.startIso).toISOString()));
      // La lista la pega el código (numerada, en este orden): «la 2» es esta 2.
      state.slotOffer = { options, matchedWish: matchedWish ?? null };
      // No se pudo mover y le ofrece otras: esas sí van.
      if (state.keepsCall === "moveFailed") state.keepsCall = null;
      return log("offer_free_call_slots", args, {
        ok: true,
        options,
        note:
          matchedWish === false
            ? `En lo que la persona dijo que puede no hay espacio en la agenda de Dayana. Estas horas (${CLOSEST_NOTE[closest ?? "any"]}) las pega el código debajo de tu mensaje, numeradas, con la pregunta: tú escribe solo una frase corta y cálida diciéndole que en lo que pidió no hay espacio, SIN horas, días ni pregunta. Si después ninguna le sirve, dile que Dayana le escribe para buscar un espacio y escala con category=other.`
            : "Estas horas las pega el código debajo de tu mensaje, numeradas, con la pregunta. Tú escribe solo una frase corta antes (p. ej. «Con gusto, estas son las horas libres de Dayana:»), SIN horas, días ni pregunta. Cuando elija, usa book_free_call con el startIso de esa hora (o option = su número en la lista).",
      });
    } catch (e) {
      return log("offer_free_call_slots", args, {
        error: "No pude leer la agenda de Dayana. Escala con category=unknown.",
        detail: e instanceof Error ? e.message : String(e),
      });
    }
  };

  const tools = {
    confirm_appointment: tool({
      description:
        "La persona confirma que asistirá a su próxima cita (responde sí al recordatorio). Márcala como confirmada y agradécele en tu respuesta.",
      inputSchema: z.object({}),
      execute: async () => {
        if (input.mode !== "live") return log("confirm_appointment", {}, { ok: true, preview: true });
        const { next } = await appointmentsFor({ contactId: input.contactId, phone: input.phone });
        if (!next) return log("confirm_appointment", {}, { ok: false, reason: "No tiene cita próxima." });
        // Solo cubre lo que la IA leyó: algo que llegó después sigue pendiente.
        await confirmAppointment(next.id, { seenInboundAt: lastInboundSeen(input.transcript, now) });
        return log("confirm_appointment", {}, { ok: true, cita: next.startsAt.toISOString() });
      },
    }),
    escalate: tool({
      description:
        "Le pasa el tema a Dayana (le avisa y le aparece en «Te toca»). Úsalo en reembolsos, descuentos o cobros que no reconoce, preguntas que no están en los DATOS, cambios de cita, quejas o temas clínicos. A la persona le llega tu holdingReply.",
      inputSchema: z.object({
        category: z.enum(["payment", "unknown", "complaint", "clinical", "reschedule", "other"]),
        severity: z.enum(["normal", "urgent"]),
        reason: z.string().max(200).describe("Para Dayana: qué pasa, en una línea."),
        suggestedReply: z
          .string()
          .max(500)
          .optional()
          .describe(
            "Solo en pagos ya hechos: el mensaje corto y cálido que Dayana puede enviar cuando verifique el pago (agradece y confirma los siguientes pasos, sin inventar montos)."
          ),
        holdingReply: z
          .string()
          .max(300)
          .optional()
          .describe(
            "El aviso corto que recibe la persona AHORA, para que no se quede sin respuesta (p. ej. «Déjame consultarlo con Dayana y te confirmo por aquí»). Sin precios. Vacío solo si te lo piden las reglas."
          ),
      }),
      execute: async ({ suggestedReply, holdingReply, ...args }) => {
        state.outcome = { kind: "escalate", ...args };
        if (suggestedReply?.trim()) state.suggestedReply = suggestedReply.trim();
        if (holdingReply?.trim()) state.holdingReply = holdingReply.trim();
        return log("escalate", { ...args, suggestedReply, holdingReply }, { ok: true });
      },
    }),
    ...paymentTools,
    ...linkTools,
    // Lo normal: la IA no busca horas; pregunta cuándo le sirve y le avisa a Dayana.
    // Con el flujo de venta, siempre sabe de dónde escribe (para ofrecer horas en su hora).
    ...(!config.booking.aiSchedules || salesOn
      ? {
          save_country: tool({
            description:
              "La persona dijo desde qué país (y ciudad) escribe. Guárdalo para agendar en su hora y no volver a preguntarlo.",
            inputSchema: z.object({
              countryIso: z.string().describe("Código de 2 letras del país: MX, CO, PE, ES, US…"),
              city: z.string().optional().describe("Ciudad o estado, si lo dijo."),
              timezone: z
                .string()
                .optional()
                .describe("Zona IANA de su ciudad si el país tiene varias (p. ej. La Paz, Baja California Sur = America/Mazatlan)."),
            }),
            execute: async (args) => {
              const iso = args.countryIso.trim().toUpperCase().slice(0, 2);
              const tz = resolvePersonTimezone(iso, args.timezone);
              if (!tz) return log("save_country", args, { error: "País no reconocido. Pregúntale de nuevo." });
              const needsCity = MULTI_ZONE_COUNTRIES.has(iso) && !args.city?.trim() && !args.timezone;
              state.country = { iso, city: args.city?.trim() || null, timezone: tz, needsCity };
              if (input.mode === "live" && input.contactId) {
                await prisma.contact
                  .update({ where: { id: input.contactId }, data: { countryIso: iso, timezone: tz } })
                  .catch(() => undefined);
              }
              // También sin contacto en el CRM: en la ficha, para la próxima vuelta.
              if (input.mode === "live" && input.conversationId) {
                await prisma.whatsAppDossier
                  .upsert({
                    where: { conversationId: input.conversationId },
                    create: { conversationId: input.conversationId, countryIso: iso, timezone: tz },
                    update: { countryIso: iso, timezone: tz },
                  })
                  .catch(() => undefined);
              }
              return log("save_country", args, {
                ok: true,
                country: countryName(iso),
                timezone: tz,
                note:
                  MULTI_ZONE_COUNTRIES.has(iso) && !args.city && !args.timezone
                    ? "Ese país tiene varias horas: pregúntale en qué ciudad está."
                    : undefined,
              });
            },
          }),
          // Con el flujo de venta, la asistente agenda con horas reales. Un
          // procedimiento viejo puede seguir diciendo «request_booking»: la
          // herramienta existe y la redirige, para que no falle la vuelta.
          ...(salesOn ? {
          request_booking: tool({
            description: "No la uses: para agendar la llamada gratis usa offer_free_call_slots y luego book_free_call.",
            inputSchema: z.object({}).passthrough(),
            execute: async (args) =>
              log("request_booking", args, {
                error: guestEvent
                  ? GUEST_NO_FREE_CALL
                  : "En este flujo agendas tú: usa offer_free_call_slots para ofrecer horas y book_free_call cuando elija una.",
              }),
          }),
          } : {
          request_booking: tool({
            description:
              "La persona quiere agendar (la llamada gratis o una sesión) o ya dijo qué día u hora le sirve. Le avisa a Dayana para que ella revise su agenda, agende y confirme. Antes tienes que saber desde qué país escribe. Úsalo UNA vez; tu respuesta dice que Dayana revisa su agenda y le confirma por aquí (nunca prometas esa hora ni que será hoy).",
            inputSchema: z.object({
              service: z.string().describe("«Llamada gratis de 15 minutos» o la sesión que pide."),
              countryIso: z.string().optional().describe("País de la persona (2 letras), el que dijo en la conversación."),
              city: z.string().optional(),
              timezone: z.string().optional().describe("Zona IANA de su ciudad si el país tiene varias."),
              when: z.string().optional().describe("El día y la hora que dijo la persona, tal cual (si ya lo dijo)."),
              localDateTime: z
                .string()
                .optional()
                .describe("Ese día y hora en la hora DE LA PERSONA, como YYYY-MM-DDTHH:mm (usa la fecha de hoy para calcular «el jueves»)."),
              note: z.string().describe("Para Dayana, en una línea: qué quiere trabajar la persona y lo importante."),
            }),
            execute: async (args) => {
              // La llamada gratis no es para quien ya fue clienta, ya la tuvo o está por revisar.
              if (noFreeCall && FREE_CALL_SERVICE.test(args.service)) {
                return log("request_booking", args, {
                  error:
                    "Esta persona no agenda la llamada gratis (ya fue clienta, ya la tuvo o está por revisar): no se la ofrezcas. Si pide ayuda o quiere retomar, dile con calidez que le pasas su mensaje a Dayana y que ella le responde por aquí, sin prometer día ni hora, y escala con category=other.",
                });
              }
              const iso = (args.countryIso ?? state.country?.iso ?? "").trim().toUpperCase().slice(0, 2);
              if (!iso) {
                return log("request_booking", args, {
                  error: "Aún no sabes desde qué país escribe. Pregúntaselo primero («¿Desde qué país me escribes?») para no confundir horarios.",
                });
              }
              const tz = resolvePersonTimezone(iso, args.timezone ?? state.country?.timezone) ?? "America/Bogota";
              const city = args.city?.trim() || state.country?.city || null;
              const place = `${countryName(iso)}${city ? ` (${city})` : ""}`;
              const time = args.localDateTime
                ? describeRequestedTime({ localDateTime: args.localDateTime, personTz: tz, place })
                : null;
              state.bookingRequest = {
                service: args.service,
                when: time?.text ?? (args.when?.trim() ? `${args.when.trim()} (hora de ${place})` : null),
                note: `${args.note.trim()} · Desde ${place}`,
              };
              // Lo que pidió para hoy o para dentro de pocas horas no se promete
              // (Valentina, 16-oct: «Dayana se comunica con ustedes hoy mismo»).
              const soon =
                (time && time.utc.getTime() - now.getTime() < 12 * 3600_000) || SOON_WORDS.test(args.when ?? "");
              return log("request_booking", args, {
                ok: true,
                note: time || args.when
                  ? `Dayana recibe el aviso. Responde corto y cálido: que le pasas su horario a Dayana y que ella revisa su agenda y le confirma por aquí. No prometas ese horario${soon ? " ni que será hoy: nunca digas «hoy mismo» ni que Dayana la llama hoy" : ""}.`
                  : "Dayana recibe el aviso. Pregúntale qué día y hora le quedan bien (en su hora), y dile que Dayana revisa su agenda y le confirma por aquí.",
              });
            },
          }),
          }),
        }
      : {}),
    // La llamada gratis con horas reales del calendario (flujo de venta).
    // A quien solo se inscribió al evento, no: las herramientas siguen (las
    // mismas para todos, por la caché) pero contestan que no se agenda.
    ...(salesOn
      ? {
          offer_free_call_slots: tool({
            description:
              "Busca 2 o 3 horas libres de verdad en el calendario de Dayana para la llamada gratis de 15 minutos, con la hora de la persona y la de Colombia: primero hoy o mañana si hay espacio, luego los días que Dayana prefiere. Úsalo cuando acepte la llamada o pida otras horas. Si la persona dijo cuándo puede o cuándo no («solo los martes», «el jueves en la tarde», «el lunes no puedo», «la otra semana»), pásalo en dias / noPuede / franja / desde. Escribe en tu mensaje las horas tal cual (label).",
            inputSchema: z.object({
              dias: z
                .array(z.string())
                .optional()
                .describe("Días que la persona PUEDE, en su hora: «lunes»…«domingo», «hoy», «mañana» o una fecha AAAA-MM-DD."),
              noPuede: z.array(z.string()).optional().describe("Días que dijo que NO puede (mismo formato)."),
              franja: z.enum(["mañana", "tarde", "noche"]).optional().describe("Si dijo en la mañana, en la tarde o en la noche."),
              desde: z.string().optional().describe("AAAA-MM-DD si dijo «desde el…», «la otra semana» (el lunes que viene)."),
            }),
            execute: offerSlots,
          }),
          book_free_call: tool({
            description:
              "Agenda la llamada gratis en una de las horas que ya le ofreciste con offer_free_call_slots y que la persona eligió. Usa el startIso exacto de esa hora.",
            inputSchema: z.object({
              startIso: z.string().optional().describe("El startIso exacto de offer_free_call_slots."),
              option: z.number().int().min(1).max(10).optional().describe("O el número que eligió en la lista numerada que recibió (1, 2, 3…)."),
              name: z.string().optional().describe("Nombre de la persona si lo dijo."),
            }),
            execute: async (args) => {
              if (guestEvent) return log("book_free_call", args, { error: GUEST_NO_FREE_CALL });
              // «la 2» es la 2 de la última lista numerada que RECIBIÓ (no una que
              // el modelo pidió en esta vuelta y ella no vio: revisión 21-oct). Si no
              // cuadra (la lista fue de Dayana), el startIso.
              const list = input.latestOffer ?? [];
              const picked = args.option ? list[args.option - 1] : undefined;
              const start = new Date(picked?.startIso ?? args.startIso ?? "");
              if (Number.isNaN(start.getTime())) {
                return log("book_free_call", args, {
                  error: args.option ? `No hay una opción ${args.option} en la lista: pasa el startIso exacto de la hora que eligió.` : "Hora inválida.",
                });
              }
              const iso = start.toISOString();
              // Las que Dayana misma le escribió («Horas libres» o a mano) también valen.
              const dayanaTexts = input.transcript
                .filter((l) => l.direction === "OUTBOUND" && !l.isAutoReply && (!l.sentAt || now.getTime() - l.sentAt.getTime() < 72 * 3600_000))
                .map((l) => l.body);
              const inLatest = (input.latestOffer ?? []).some((o) => new Date(o.startIso).toISOString() === iso);
              if (!offeredNow.has(iso) && !offeredBefore.includes(iso) && !inLatest && !dayanaOfferedSlot(dayanaTexts, iso, timezone)) {
                return log("book_free_call", args, { error: "Esa hora no se la ofreciste. Usa offer_free_call_slots primero." });
              }
              const tz = personTz() ?? timezone;
              const service = freeCallService(config);
              const name = args.name?.trim() || input.name;
              const label = dualZoneLabel(iso, tz, timezone);
              if (input.mode === "preview" || !input.conversationId) {
                // Lo que recibiría: la confirmación del código (la evaluación la
                // califica igual). Sin «agendar sola» en vivo queda por aprobar: no se confirma.
                if (autoBook) state.bookingNotice = { kind: "booked", label, text: bookedMessage("booked", label, sureFirstName(nameInfo)) };
                return log("book_free_call", args, { ok: true, simulated: true, label });
              }
              // Ya la tiene: «sí, perfecto» después de agendar no es otra cita
              // (antes caía en «Autoriza la cita» por segunda vez).
              const upcoming = await upcomingFreeCall(input.conversationId, config, now).catch(() => null);
              // La puso Dayana en su calendario: la IA no mueve eventos de Dayana
              // (auditoría 21-oct: `moveFreeCall` la rechaza y la nota de «ofrécele
              // otras horas» la dejaba en un ciclo de horas que nunca se agendan).
              if (upcoming && upcoming.source === "calendar" && upcoming.startsAt.getTime() !== start.getTime()) {
                state.keepsCall = "booked";
                return log("book_free_call", args, {
                  ok: true,
                  alreadyBooked: true,
                  label: dualZoneLabel(upcoming.startsAt.toISOString(), tz, timezone),
                  note: "Esa llamada la agendó Dayana y no la puedes mover. Dile que le pasas su pedido a Dayana para cambiarla y escala con category=reschedule. No le ofrezcas más horas.",
                });
              }
              // Pidió otra hora de las que se le ofrecieron: se mueve la que tiene
              // (Alexandra, 21-oct: le dejaba el jueves y la IA le confirmó el viernes sin cita).
              if (upcoming && upcoming.startsAt.getTime() !== start.getTime() && autoBook) {
                try {
                  const moved = await moveFreeCall({ config, dayanaTz: timezone, personTz: tz, bookingId: upcoming.id, start });
                  afterFreeCallMoved({ conversationId: input.conversationId, booking: moved, dayanaTz: timezone });
                  state.booking = { id: moved.bookingId, startsAt: moved.startsAt, service: service.name, meetUrl: null };
                  state.bookingNotice = { kind: "moved", label: moved.label, text: bookedMessage("moved", moved.label, sureFirstName(nameInfo)) };
                  return log("book_free_call", args, {
                    ok: true,
                    booked: true,
                    moved: true,
                    label: moved.label,
                    note: "Listo: su llamada se movió a esta hora (la anterior ya no está). Confírmale el nuevo día y la hora (en su hora) y que Dayana la llama por WhatsApp a este número. No escribas enlaces.",
                  });
                } catch (e) {
                  state.keepsCall = "moveFailed";
                  return log("book_free_call", args, {
                    error: e instanceof FreeCallError ? e.message : "No se pudo mover la llamada.",
                    keeps: dualZoneLabel(upcoming.startsAt.toISOString(), tz, timezone),
                    note: "No se movió: sigue la que tenía (keeps). Ofrécele otras horas con offer_free_call_slots o dile que sigue en pie la que tiene. Nunca digas que quedó a la hora nueva.",
                  });
                }
              }
              if (upcoming) {
                state.keepsCall = "booked";
                return log("book_free_call", args, {
                  ok: true,
                  alreadyBooked: true,
                  label: dualZoneLabel(upcoming.startsAt.toISOString(), tz, timezone),
                  note: `Ya tiene agendada su llamada gratis (label): confírmale ese día y esa hora con calidez, que Dayana la llama por WhatsApp a este número. No digas que la agendas otra vez. ${autoBook ? "Si pide otra hora, ofrécele horas con offer_free_call_slots y usa book_free_call con la que elija (se mueve la que tiene)." : "Si pide otra hora, escala con category=reschedule."}`,
                });
              }
              if (autoBook) {
                try {
                  const booking = await bookFreeCall({
                    config,
                    dayanaTz: timezone,
                    personTz: tz,
                    start,
                    conversationId: input.conversationId,
                    contactId: input.contactId,
                    phone: input.phone,
                    name: name ?? null,
                  });
                  await afterFreeCallBooked({ conversationId: input.conversationId, contactId: input.contactId, phone: input.phone, booking });
                  state.booking = { id: booking.bookingId, startsAt: booking.startsAt, service: service.name, meetUrl: null };
                  state.bookingNotice = { kind: "booked", label: booking.label, text: bookedMessage("booked", booking.label, sureFirstName(nameInfo)) };
                  return log("book_free_call", args, {
                    ok: true,
                    booked: true,
                    label: booking.label,
                    note: "Agendada. Confírmale el día y la hora (en su hora) y que Dayana la llama por WhatsApp a este número. No escribas enlaces.",
                  });
                } catch (e) {
                  if (e instanceof FreeCallError) {
                    return log("book_free_call", args, {
                      error: e.message,
                      note:
                        e.code === "already_booked"
                          ? "Recuérdale con calidez la llamada que ya tiene."
                          : "Ofrécele otras horas con offer_free_call_slots.",
                    });
                  }
                  return log("book_free_call", args, {
                    error: "No se pudo agendar. Escala con category=unknown.",
                    detail: e instanceof Error ? e.message : String(e),
                  });
                }
              }
              // Sin agendar sola: queda para que Dayana la autorice (como cualquier cita).
              state.pendingBooking = {
                service: service.name,
                startIso: iso,
                durationMin: service.minutes,
                name: name ?? null,
                label,
                whatsappCall: true,
              };
              return log("book_free_call", args, {
                ok: true,
                pendingApproval: true,
                label,
                note: "Queda para que Dayana la confirme. Dile que en un momento le confirmamos la hora por aquí. No escribas enlaces.",
              });
            },
          }),
        }
      : {}),
    ...(config.booking.enabled && config.booking.aiSchedules
      ? {
          check_availability: tool({
            description:
              "Horas libres en el calendario de Dayana para un servicio. Devuelve opciones ya formateadas; ofrece 2 o 3.",
            inputSchema: z.object({
              service: z.string().describe(`Uno de: ${serviceNames.join(", ")}`),
              fromDate: z
                .string()
                .optional()
                .describe("YYYY-MM-DD desde el que buscar, si la persona pidió un día."),
              toDate: z.string().optional().describe("YYYY-MM-DD hasta (inclusive)."),
              partOfDay: z.enum(["any", "morning", "afternoon"]).optional(),
            }),
            execute: async (args) => {
              try {
                const minutes = durationOf(args.service);
                const from = args.fromDate
                  ? zonedDateTimeToUtc(args.fromDate, "00:00", timezone)
                  : undefined;
                const to = args.toDate
                  ? new Date(zonedDateTimeToUtc(args.toDate, "00:00", timezone).getTime() + 86_400_000)
                  : undefined;
                let slots = await availableSlots({ config: config.booking, durationMin: minutes, timezone, from, to, now });
                if (args.partOfDay && args.partOfDay !== "any") {
                  slots = slots.filter((s) => {
                    const h = Number(s.time.slice(0, 2));
                    return args.partOfDay === "morning" ? h < 12 : h >= 12;
                  });
                }
                const picked = spreadSlots(slots, 4);
                for (const p of picked) seenOptions.set(p.startIso, formatSlot(p.startIso, timezone));
                return log("check_availability", args, {
                  durationMinutes: minutes,
                  options: picked.map((s) => ({ startIso: s.startIso, label: formatSlot(s.startIso, timezone) })),
                  note:
                    picked.length === 0
                      ? "No hay horas libres en ese rango. Ofrece buscar otro día."
                      : config.booking.approveSlots
                        ? "NO escribas estas horas en tu mensaje: usa offer_times con 2 o 3 de ellas; Dayana las aprueba antes de que le lleguen a la persona."
                        : undefined,
                });
              } catch (e) {
                return log("check_availability", args, {
                  error:
                    "No se pudo leer el calendario en este momento. NO escales por esto: sigue la conversación con normalidad y, si quiere agendar, pregúntale qué días y franja le quedan mejor y dile que Dayana le confirma la hora exacta.",
                  detail: e instanceof Error ? e.message : String(e),
                });
              }
            },
          }),
          ...(config.booking.approveSlots
            ? {
                offer_times: tool({
                  description:
                    "Propón a Dayana 2 o 3 horas (de check_availability) para ofrecerle a la persona. Ella las aprueba, quita o cambia, y solo entonces se envían. Tu respuesta final es el mensaje para la persona con {{HORARIOS}} donde van las horas (no escribas las horas tú).",
                  inputSchema: z.object({
                    service: z.string().describe(`Uno de: ${serviceNames.join(", ")}`),
                    startIsos: z.array(z.string()).min(1).max(4).describe("startIso exactos de check_availability."),
                  }),
                  execute: async (args) => {
                    const options = args.startIsos
                      .filter((iso) => seenOptions.has(iso))
                      .map((iso) => ({ startIso: iso, label: seenOptions.get(iso)! }));
                    if (options.length === 0) {
                      return log("offer_times", args, { error: "Esas horas no salieron de check_availability. Úsalo primero." });
                    }
                    state.pendingSlots = { service: args.service, options };
                    return log("offer_times", args, {
                      ok: true,
                      note: "Escribe ahora el mensaje para la persona: cálido, corto, y con {{HORARIOS}} en el lugar donde van las horas (Dayana las aprueba antes).",
                    });
                  },
                }),
              }
            : {}),
          book_appointment: tool({
            description:
              "Agenda la cita en el Google Calendar de Dayana. Solo con una hora que salió de check_availability y DESPUÉS de que la persona confirmó explícitamente ese día y esa hora.",
            inputSchema: z.object({
              service: z.string().describe(`Uno de: ${serviceNames.join(", ")}`),
              startIso: z.string().describe("El startIso exacto de check_availability."),
              name: z.string().optional().describe("Nombre de la persona si lo dijo."),
            }),
            execute: async (args) => {
              const minutes = durationOf(args.service);
              const start = new Date(args.startIso);
              if (Number.isNaN(start.getTime())) {
                return log("book_appointment", args, { error: "Hora inválida." });
              }
              if (input.mode === "preview" || !input.conversationId) {
                return log("book_appointment", args, {
                  ok: true,
                  simulated: true,
                  label: formatSlot(args.startIso, timezone),
                  meetUrl: config.booking.addMeet ? "https://meet.google.com/(de-prueba)" : null,
                });
              }
              if (config.booking.approveSlots) {
                const approved = await approvedSlotsFor(input.conversationId);
                if (!approved.includes(start.toISOString())) {
                  return log("book_appointment", args, {
                    error:
                      "Esa hora no la aprobó Dayana. Usa check_availability y offer_times para proponerle horas (ella las aprueba antes de ofrecerlas).",
                  });
                }
              }
              try {
                const name = args.name?.trim() || input.name;
                // La hora tiene que seguir libre ahora; se vuelve a mirar al aprobar.
                const free = await availableSlots({
                  config: config.booking,
                  durationMin: minutes,
                  timezone,
                  now,
                  from: new Date(start.getTime() - 60_000),
                  to: new Date(start.getTime() + minutes * 60_000 + 60_000),
                });
                if (!free.some((slot) => slot.startIso === start.toISOString())) {
                  throw new SlotUnavailableError("Esa hora ya no está libre.");
                }
                state.pendingBooking = {
                  service: args.service,
                  startIso: start.toISOString(),
                  durationMin: minutes,
                  name: name ?? null,
                  label: formatSlot(args.startIso, timezone),
                };
                return log("book_appointment", args, {
                  ok: true,
                  pendingApproval: true,
                  label: formatSlot(args.startIso, timezone),
                  note: "La cita queda lista para que Dayana la autorice. Escribe el mensaje de confirmación con el servicio, el día y la hora. NO escribas ningún enlace: el de la videollamada se agrega solo cuando Dayana la aprueba.",
                });
              } catch (e) {
                if (e instanceof SlotUnavailableError) {
                  return log("book_appointment", args, {
                    error: `${e.message} Vuelve a usar check_availability y ofrece otras horas.`,
                  });
                }
                return log("book_appointment", args, {
                  error: "No se pudo agendar. Escala con category=unknown.",
                  detail: e instanceof Error ? e.message : String(e),
                });
              }
            },
          }),
        }
      : {}),
    ...(stickers.length > 0
      ? {
          send_sticker: tool({
            description:
              "Manda, después de tu mensaje, uno de los stickers que usa Dayana, solo cuando ella lo mandaría en una situación así (mira lo que suele escribir antes). Como mucho uno, y no en temas delicados.",
            inputSchema: z.object({
              sticker: z.number().int().min(1).max(stickers.length).describe("Número del sticker de la lista."),
            }),
            execute: async ({ sticker }) => {
              const chosen = stickers[sticker - 1];
              state.stickerUrl = chosen?.url ?? null;
              return log("send_sticker", { sticker }, { ok: Boolean(chosen) });
            },
          }),
        }
      : {}),
    // Pagos: solo el enlace que Dayana ya creó (send_payment_link) y las
    // cuentas de Ajustes (send_payment_info). La IA no crea enlaces nuevos.
    search_past_chats: tool({
      description:
        "Busca cómo contestó Dayana antes sobre un tema (para imitar su forma, no para sacar precios).",
      inputSchema: z.object({ query: z.string().min(2).max(200) }),
      execute: async (args) => {
        const [similar, literal] = await Promise.all([
          findSimilarExamples(args.query, 4).catch(() => []),
          searchDayanaReplies(args.query).catch(() => []),
        ]);
        return log("search_past_chats", args, {
          examples: similar.map((e) => ({ persona: redactPrices(e.clientText), dayana: softenForPrompt(redactPrices(e.replyText)) })),
          dayanaWrote: literal.map(redactPrices),
        });
      },
    }),
  };

  const nowLabel = `${new Intl.DateTimeFormat("es-CO", { timeZone: timezone, weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(now)}, ${getTimeLabelInTz(now, timezone)} (${timezone}, fecha ${getDateKeyInTz(now, timezone)})`;

  const dossierPart = input.dossier
    ? `FICHA DE LA PERSONA (armada con TODO su chat, también lo anterior a lo que lees abajo; es la misma persona). Si la ficha escribe en femenino o masculino, eso NO dice su género: guíate solo por «Habla de sí en…». Lo que la ficha dice que «se le indicó» lo dijo la asistente y puede estar mal: los DATOS mandan:\n${input.dossier}`
    : null;
  const snippetsPart = input.olderSnippets?.length
    ? `LO QUE SE HABLÓ ANTES SOBRE ESTO (mensajes viejos de este mismo chat que coinciden con lo que acaba de escribir):\n${transcriptText(input.olderSnippets, timezone)}`
    : null;
  const examplesPart = examplesBlock(examples);
  const transcriptPart = `${transcriptHeader(input.transcript, timezone)}. Léela entera antes de contestar: no preguntes lo que ya se habló, no repitas lo que ya se dijo y sigue el hilo donde quedó:\n${transcriptText(input.transcript, timezone)}`;
  // El paquete que le toca: el enlace de Dayana que nombran sus notas (Joselyn:
  // 3 y 6, primero el de 3) o el último; si no hay enlace, el de la cotización.
  const quoteLink = quoteSit && chatLinks.length ? pickPaymentLink(chatLinks, input.memory) : null;
  const quotePack = quoteLink && /\/therapy-\d+/i.test(quoteLink.url) ? quoteLink.label : (quoteSit?.how.pack ?? null);

  const promptText = [
      // Primero la hora (como cuando iba en las reglas): fuera de las reglas
      // para que la caché de Gemini cubra reglas y herramientas.
      `AHORA: ${nowLabel}.`,
      `DATOS (lo único que puedes afirmar):\n${await businessFacts(config, { noFreeCall, guest: Boolean(guestEvent) })}`,
      await playbooksBlock().catch(() => null),
      input.client ? `CLIENTA EN EL CRM:\n${input.client}` : null,
      chatLink
        ? `ENLACE DE PAGO QUE DAYANA YA LE MANDÓ${chatLink.sentAt ? ` (${new Intl.DateTimeFormat("es-CO", { timeZone: timezone, weekday: "long", day: "numeric", month: "long" }).format(chatLink.sentAt)})` : ""}. Dayana ya le dijo cómo pagar: si te confirma que habló con Dayana (un «sí» a «¿pudiste hablar con Dayana?» no confirma ninguna cita), quiere pagar o empezar, o pregunta cómo pagar, tu respuesta es que puede hacer el pago por el enlace que le envió Dayana (usa send_payment_link: lo vuelve a poner debajo) y que te mande el comprobante por aquí cuando lo haga. No le mandes las cuentas salvo que las pida.${chatLinks.length > 1 ? ` Le mandó varios: ${chatLinks.map((l) => `«${l.label}»`).join(", ")}. Si las notas de Dayana o el chat dicen cuál le corresponde, pásalo en send_payment_link (cual); si no, el último.` : ""}`
        : chatPayInfo
          ? `DAYANA YA LE MANDÓ CÓMO PAGAR${chatPayInfo.sentAt ? ` (${new Intl.DateTimeFormat("es-CO", { timeZone: timezone, weekday: "long", day: "numeric", month: "long" }).format(chatPayInfo.sentAt)})` : ""}: ya hablaron de la sesión y los valores. Si quiere pagar o empezar, dile que puede hacer el pago con los datos que le envió Dayana y que te mande el comprobante por aquí para que Dayana lo verifique; pregúntale si tiene alguna dificultad para pagar. No le mandes otras cuentas salvo que las pida.`
          : null,
      upcomingCall
        ? upcomingCall.source === "calendar"
          ? `SU LLAMADA GRATIS YA ESTÁ AGENDADA (la puso Dayana en su calendario): ${dualZoneLabel(upcomingCall.startsAt.toISOString(), personTz() ?? timezone, timezone)}. Si pide cambiarla o cancelarla, dile que le pasas su pedido a Dayana y escala con category=reschedule (tú no la mueves).`
          : `SU LLAMADA GRATIS YA ESTÁ AGENDADA: ${dualZoneLabel(upcomingCall.startsAt.toISOString(), personTz() ?? timezone, timezone)}. Si pide cambiarla a otro día u hora, no escales: ofrécele horas con offer_free_call_slots y, cuando elija una, usa book_free_call (mueve la que tiene; nunca le digas la hora nueva hasta que book_free_call diga que se movió). Si quiere cancelarla, escala con category=reschedule.`
        : null,
      toDayana && !input.clientMode
        ? "LA PERSONA LE ESTÁ RESPONDIENDO A DAYANA (lo último antes de sus mensajes lo escribió Dayana): no te metas en esa conversación. Si solo agradece, saluda, comenta o le contesta algo a Dayana, usa no_reply y no escribas nada. Contesta solo si pregunta algo que puedes responder con los DATOS o si quedó algo pendiente que tú resuelves (cómo pagar, recibir su comprobante, las horas de la llamada gratis)."
        : null,
      dossierPart,
      input.memory ? `MEMORIA (lo que sabemos de esta persona):\n${input.memory}` : null,
      snippetsPart,
      examplesPart,
      stickers.length > 0
        ? `STICKERS DE DAYANA (usa send_sticker con el número; cuándo los manda ella):\n${stickers
            .map((st, i) => `${i + 1}. usado ${st.uses} veces; lo manda después de: ${st.contexts.map((c) => `«${c}»`).join(" / ") || "(sin texto antes)"}`)
            .join("\n")}`
        : null,
      `SITUACIÓN DEL CHAT: ${input.situation ?? chatSituation(input.transcript, Boolean(input.client))}`,
      input.stage
        ? // A quien solo se inscribió al evento, sin «la lleva a la llamada gratis» de «Nueva».
          [`ESTADO DE LA PERSONA CON DAYANA: ${STAGE_LABEL[input.stage]}.${guestEvent ? "" : ` ${STAGE_HELP[input.stage]}`}`, STAGE_AI_RULE[input.stage]]
            .filter(Boolean)
            .join("\n")
        : null,
      quoteSit ? quotePromptLine(quoteSit, input.freeCall?.personTimezone ?? timezone, quotePack) : null,
      // Preguntó por el taller ahora: la información y la llamada para inscribirse.
      // Después (el país, la hora, el «sí»): seguir con el agendamiento.
      workshop && workshopAskNow
        ? workshopLine(workshop, { upcomingLabel: upcomingLabelText })
        : workshop && workshopFlow && !workshopCall
          ? workshopFollowLine(input.transcript, workshop, now.getTime())
          : workshop && workshopSpot
            ? workshopPayLine(workshop)
            : null,
      guestEvent
        ? guestLine(guestEvent, input.transcript, { timezone, now: now.getTime() })
        : salesOn
        ? flowStateText(
            flowState(input.transcript, {
              keyQuestions: config.salesFlow.buyButtons.map((b) => b.keyQuestion),
              offeredSlots: offeredBefore.length > 0,
              // La oferta de la llamada para el taller no dice «gratis»: también es la invitación
              // (desde ese mensaje; si pregunta ahora, la ofrece este).
              isInvite: workshop && workshopFlow && !workshopAskNow ? (l) => isWorkshopOffer(l, workshop) : undefined,
            })
          )
        : null,
      nameLine(nameInfo),
      `Su número: +${input.phone}.`,
      countryHint(input.phone),
      transcriptPart,
      input.images?.length
        ? `IMÁGENES: van adjuntas las ${input.images.length} últimas fotos o stickers que mandó la persona (la más reciente primero). Míralas.`
        : null,
    ]
      .filter(Boolean)
      .join("\n\n");

  // Con una clienta, solo pagos (y pasarle lo demás a Dayana).
  // Le está respondiendo a Dayana: puede no hacer falta escribir nada (dueño, 21-oct).
  const noReplyTool = tool({
    description:
      "No escribirle nada: la persona le está respondiendo a Dayana (lo último lo escribió ella) y solo agradece, saluda, comenta o le contesta algo que no necesita respuesta tuya. No lo uses si pregunta algo que puedes responder con los DATOS o si quedó algo pendiente que tú resuelves.",
    inputSchema: z.object({ motivo: z.string().max(160).describe("Para Dayana, en una línea: por qué no hace falta contestar.") }),
    execute: async ({ motivo }) => {
      state.noReply = motivo;
      return log("no_reply", { motivo }, { ok: true, note: "No escribas nada más." });
    },
  });
  const activeTools = input.clientMode
    ? { escalate: tools.escalate, ...paymentTools }
    : toDayana
      ? { ...tools, no_reply: noReplyTool }
      : tools;

  const system = systemPrompt(config, { salesFlow: salesOn && !input.clientMode, autoBook, clientMode: input.clientMode });
  const result = await generateText({
    model: google(modelId()),
    system,
    ...(input.images?.length
      ? {
          messages: [
            {
              role: "user" as const,
              content: [
                { type: "text" as const, text: promptText },
                // Parte `file`, no `image`: el SDK ya convertía la segunda en la
                // primera (mismo pedido a Gemini) pero avisaba «deprecated» en
                // cada llamada con foto — 95 veces en el último mes.
                ...input.images.map((img) => ({ type: "file" as const, data: img.data, mediaType: img.mediaType })),
              ],
            },
          ],
        }
      : { prompt: promptText }),
    tools: activeTools,
    stopWhen: [isStepCount(spendLimits(config).maxSteps), hasToolCall("escalate"), hasToolCall("no_reply")],
  });

  // Le respondía a Dayana y el modelo no escribió nada ni usó herramientas: es
  // un «no hace falta contestar», no «no supo qué contestar» (Raquel, 22-oct:
  // a su audio para Dayana le llegó «Déjame consultarlo con Dayana»).
  // Una pregunta («¿cuánto cuesta?») sigue el camino de siempre (revisión 22-oct).
  // Google bloqueó el pedido, también con el modelo completo (`lib/ai/gemini.ts`):
  // el modelo ni lo leyó. Pasa a Dayana con ese motivo (Andrea y Sil, 23/24-oct).
  const blockedBy = (result.providerMetadata?.google?.promptFeedback as { blockReason?: unknown } | null | undefined)?.blockReason;
  // Otra vez sin lo que cambia entre pedidos (Adrienne, Nayeli, 26-oct: «Bien gracias», «Si x fa»
  // y «Vaya está bien» bloqueados; el mismo chat un mensaje antes pasaba). Si también se bloquea,
  // sigue el camino de abajo (horas por código si iba a agendar; si no, a Dayana).
  if (blockedBy && !input.slim && toolCalls.length === 0) {
    console.warn(`[whatsapp-agent] Google bloqueó el pedido (${String(blockedBy)}): otra vez sin ejemplos, ficha ni mensajes viejos`);
    const again = await think({ ...input, slim: true, dossier: null, olderSnippets: [] });
    return { ...again, toolCalls: [{ tool: "gemini_blocked", input: { reason: String(blockedBy) }, output: { retried: "sin ejemplos, ficha ni mensajes viejos" } }, ...again.toolCalls] };
  }
  const askedSomething = lastInbound.some((t) => /[?¿]/.test(t));
  if (toDayana && !blockedBy && !askedSomething && !input.clientMode && !state.outcome && !state.noReply && !result.text.trim() && toolCalls.length === 0) {
    state.noReply = "Le estaba respondiendo a Dayana; no hacía falta que la asistente escribiera.";
  }
  const rawOutcome: BrainOutcome =
    state.outcome ??
    (state.noReply && !result.text.trim() ? { kind: "reply", message: "" } : null) ??
    (result.text.trim()
      ? { kind: "reply", message: toWhatsAppFormat(result.text).slice(0, 1500) }
      : {
          kind: "escalate",
          category: "unknown",
          severity: "normal",
          reason: blockedBy
            ? `Google (Gemini) bloqueó este chat y la IA no pudo leerlo (${String(blockedBy)}): contéstale tú.`
            : "El asistente no supo qué contestar.",
        });
  // Lo que cuenta de su vida nunca es «urgente» (dueña, 24-oct: «es para ventas y
  // cierres», nada de urgencias ni líneas de emergencia; Joselyn, 21-oct: el modelo
  // puso urgente a «quítame la angustia y los miedos»).
  const recentInbound = input.transcript.filter((l) => l.direction === "INBOUND").slice(-10).map((l) => l.body);
  const modelOutcome: BrainOutcome =
    rawOutcome.kind === "escalate" && rawOutcome.category === "clinical" && rawOutcome.severity === "urgent"
      ? { ...rawOutcome, severity: "normal" }
      : rawOutcome;
  // Mandó el enlace de la sesión urgente y aun así escaló («para que Dayana
  // agende»): Dayana ya recibe el aviso (con el motivo), la persona recibe la
  // oferta. Una crisis, un pago o una queja sí se escalan.
  const agendaOnly =
    modelOutcome.kind === "escalate" &&
    state.urgentSession &&
    ["other", "unknown", "reschedule"].includes(modelOutcome.category) &&
    modelOutcome.severity !== "urgent";
  if (agendaOnly && modelOutcome.kind === "escalate" && state.urgentSession) state.urgentSession.note = modelOutcome.reason;
  // Volvió a poner el enlace de pago de Dayana y aun así escaló sin motivo
  // claro («Déjame consultarlo con Dayana»): la persona recibe el enlace.
  const chatLinkOnly =
    !agendaOnly &&
    modelOutcome.kind === "escalate" &&
    Boolean(chatLink) &&
    chatLinks.some((l) => l.url === state.paymentLink) &&
    ["other", "unknown"].includes(modelOutcome.category) &&
    modelOutcome.severity !== "urgent";
  // Pidió entrar a la comunidad y el modelo escaló («Déjame consultarlo con
  // Dayana», Ruth, 23-oct): entra con el enlace (dueña, 14-oct: no se escala).
  const communityOnly =
    !agendaOnly &&
    !chatLinkOnly &&
    modelOutcome.kind === "escalate" &&
    Boolean(community) &&
    ["other", "unknown"].includes(modelOutcome.category) &&
    modelOutcome.severity !== "urgent" &&
    asksToJoinCommunity(lastInbound);
  if (communityOnly && modelOutcome.kind === "escalate") {
    if (community && !state.links.includes(community)) {
      addLink(community);
      log("send_community_link", { auto: true }, { ok: true, note: "Lo pegó el código: pidió entrar a la comunidad y el modelo escaló." });
    }
    // Dayana igual se entera de lo que el modelo quería pasarle (la persona no lo ve).
    state.silentEscalation = {
      category: modelOutcome.category,
      severity: "normal",
      reason: `${modelOutcome.reason} (La asistente le mandó el enlace de la comunidad.)`.slice(0, 300),
    };
  }
  // Pidió la cuenta, la herramienta pegó los datos y aun así escaló («Déjame
  // consultarlo con Dayana», eval ENNY 21-oct): la persona recibe los datos.
  const paymentDataOnly =
    !agendaOnly &&
    !chatLinkOnly &&
    !communityOnly &&
    modelOutcome.kind === "escalate" &&
    state.paymentDetails.length > 0 &&
    asksForBankDetails(lastInbound) &&
    ["payment", "other", "unknown"].includes(modelOutcome.category) &&
    modelOutcome.severity !== "urgent";
  // Después de la cotización pide cómo pagar («me envías la forma de pago»,
  // ENNY, 23-oct) y el modelo escaló igual: en qué quedó con Dayana y, debajo,
  // solo lo seguro (nunca escrito por el modelo): el enlace de Dayana (el del
  // paquete que pide o el de sus notas) o el del CRM; los datos de Ajustes si
  // son, cifra por cifra, los que mandó Dayana; si no, «con los datos que te
  // envió Dayana». Lo demás (otro paquete, cuotas, «ya pagué», el Meet) sigue
  // escalando. Dayana recibe el aviso del modelo sin que la persona lo vea.
  const quotePayCandidate =
    !agendaOnly &&
    !chatLinkOnly &&
    !communityOnly &&
    !paymentDataOnly &&
    modelOutcome.kind === "escalate" &&
    modelOutcome.severity !== "urgent" &&
    ["payment", "other", "unknown"].includes(modelOutcome.category) &&
    Boolean(quoteSit) &&
    quoteSit?.state !== "pago_enviado" &&
    quoteSit?.state !== "no_quiere" &&
    !input.clientMode &&
    !state.receipt &&
    !lastInboundMedia &&
    asksHowToPay(lastInbound) &&
    !saysSelfHarm(lastInbound);
  const quotePay = quotePayCandidate
    ? await (async () => {
        const asked = askedPackage(lastInbound.join(" "));
        const byPack = asked ? (chatLinks.find((l) => new RegExp(`/therapy-${asked}\\b`, "i").test(l.url)) ?? null) : quoteLink;
        if (asked && !byPack) return null;
        const wantsBank = asksForBankDetails(lastInbound);
        // Datos de verdad (no solo un enlace) que Dayana le mandó ella misma.
        const withoutLinks = (b: string) => b.replace(/https?:\/\/\S+\/pagar\/\S+/gi, "");
        const dayanaData = dayanaPaymentDataBodies(input.transcript, now).filter((b) => isPaymentData(withoutLinks(b)));
        // Los últimos datos que le llegaron (de Dayana, o el bloque que pegó el código):
        // si son una cuenta de Ajustes, esa. Unos de Dayana más nuevos ganan a un
        // bloque viejo de la asistente (Raquel: Western Union de Dayana después).
        const lastData =
          [...input.transcript].reverse().find((l) => l.direction === "OUTBOUND" && l.body && isPaymentData(withoutLinks(l.body)))?.body ?? null;
        const sameMethod = lastData ? (methods.find((m) => sharesAccount(m.details, lastData)) ?? null) : null;
        if (!wantsBank) {
          // Un enlace del CRM: el paquete no se sabe por el enlace del chat.
          const crm = asked ? null : await activePaymentLinkFor(input.contactId).catch(() => null);
          if (crm) return { what: "link" as const, url: crm.url, pack: null, method: null };
          // Si pide otro paquete no es «en lo que quedaron».
          if (byPack) return { what: "link" as const, url: byPack.url, pack: asked ? null : /\/therapy-\d+/i.test(byPack.url) ? byPack.label : quotePack, method: null };
        }
        if (sameMethod) return { what: "data" as const, url: null, pack: quotePack, method: sameMethod };
        if (dayanaData.length) return { what: "dayana_data" as const, url: null, pack: quotePack, method: null };
        return null;
      })()
    : null;
  if (quotePay && modelOutcome.kind === "escalate") {
    if (quotePay.url) {
      state.paymentLink = quotePay.url;
      log("send_payment_link", { auto: true }, { ok: true, note: "Lo pegó el código: pidió cómo pagar lo que le cotizó Dayana." });
    }
    if (quotePay.method && !state.paymentDetails.includes(quotePay.method.details)) {
      state.paymentDetails.push(quotePay.method.details);
      log("send_payment_info", { auto: true, method: quotePay.method.key }, { ok: true, label: quotePay.method.label, note: "Lo pegó el código: son los mismos datos que le mandó Dayana." });
    }
    state.silentEscalation = {
      category: modelOutcome.category,
      severity: "normal",
      reason: `${modelOutcome.reason} (La asistente le volvió a mandar cómo pagar lo que le cotizaste.)`.slice(0, 300),
    };
  }
  // Preguntó por el taller abierto y el modelo dijo que no hay ninguno (Noralma,
  // 24-oct), le mandó cómo pagar su proceso (Naty) o se lo pasó a Dayana: sale
  // la respuesta del código (abierto, cuándo es y la llamada para inscribirse).
  // Nunca encima de algo grave (sigue `serious`) ni de un pago («ya pagué el taller»: escala).
  // Si eligió separar su cupo (25-oct) y el modelo le mandó lo de su proceso o
  // lo escaló, también como pago: el enlace del taller.
  const workshopGuard =
    Boolean(workshop) &&
    !input.clientMode &&
    !state.receipt &&
    !saysSelfHarm([...lastInbound, modelOutcome.kind === "escalate" ? modelOutcome.reason : null]) &&
    !agendaOnly &&
    !chatLinkOnly &&
    !communityOnly &&
    !paymentDataOnly &&
    !quotePay;
  const wrongWorkshopReply =
    modelOutcome.kind === "reply" && (saysNoWorkshop(modelOutcome.message) || Boolean(state.paymentLink) || state.paymentDetails.length > 0);
  // Una promoción que la IA no conoce (dueña, 25-oct: «el modelo deja de responder y la
  // persona no tiene respuesta… a veces las promociones tienen tiempo limitado»): siempre el
  // enlace + «la promoción te la confirma Dayana», conteste o escale el modelo (nunca la confirma).
  const promoFix = workshopPromo && !(modelOutcome.kind === "escalate" && modelOutcome.category === "clinical");
  const workshopFix: "link" | "info" | null = !workshopGuard
    ? null
    : workshopSpot &&
        (promoFix || wrongWorkshopReply || (modelOutcome.kind === "escalate" && ["other", "unknown", "payment"].includes(modelOutcome.category)))
      ? "link"
      : workshopAskNow && (wrongWorkshopReply || (modelOutcome.kind === "escalate" && ["other", "unknown"].includes(modelOutcome.category)))
        ? "info"
        : null;
  const workshopOnly = workshopFix !== null;
  if (workshopOnly) {
    state.paymentLink = null;
    state.paymentDetails = [];
    if (workshopFix === "link" && workshopPay) {
      addLink(workshopPay);
      log("send_workshop_link", { auto: true }, { ok: true, note: "Lo pegó el código: eligió separar su cupo en el taller." });
    } else {
      log("workshop_reply", { auto: true }, { ok: true, note: "Lo puso el código: preguntó por el taller abierto." });
    }
    if (modelOutcome.kind === "escalate") {
      state.silentEscalation ??= {
        category: modelOutcome.category,
        severity: "normal",
        reason: `${modelOutcome.reason} (${
          workshopFix === "link"
            ? "La asistente le mandó el enlace de pago del taller para separar su cupo."
            : workshopPay
              ? "La asistente le contó del taller y le preguntó si separa su cupo o agenda la llamada."
              : "La asistente le contó del taller y le ofreció la llamada para inscribirse."
        })`.slice(0, 300),
      };
    }
    // Contestó el modelo, pero la promoción la confirma Dayana: se entera igual (la persona lo sabe).
    if (promoFix) {
      state.silentEscalation ??= {
        category: "payment",
        severity: "normal",
        reason: `Pregunta por una promoción («${saidNow.slice(0, 160)}»). La asistente le mandó el enlace del taller y le dijo que tú le confirmas la promoción.`,
      };
    }
  }
  // Nunca deja de responder (dueño, 21-oct; `serious-reply.ts`): lo delicado
  // recibe una frase de apoyo y el siguiente paso (la llamada gratis o el pago),
  // y Dayana un aviso normal que la persona no ve. Nunca líneas de emergencia
  // ni «urgente» (dueña, 24-oct: «es para ventas y cierres»).
  // - Dice que quiere morir o hacerse daño (`saysSelfHarm`, ahora o en lo que
  //   escaló), o algo clínico (angustia, miedos): ya tuvo la llamada → el paso
  //   del pago, cada vez más directo; antes de la llamada → la llamada gratis.
  // - El modelo escribió por su cuenta una línea de emergencias o «urgencias»
  //   (`givesEmergencyAdvice`; Francy dijo que la llamada «se cortó»): lo mismo,
  //   sin aviso.
  // - Ya tuvo la llamada y escala porque pide otra llamada, una consulta o una
  //   sesión: el paso del pago (sin aviso: no es delicado).
  // Un enlace que no abre, una factura, un precio, una queja: siguen escalando.
  const escalated =
    modelOutcome.kind === "escalate" &&
    !agendaOnly &&
    !chatLinkOnly &&
    !communityOnly &&
    !paymentDataOnly &&
    !quotePay &&
    !workshopOnly &&
    !input.clientMode &&
    !state.receipt;
  const riskNow = !input.clientMode && saysSelfHarm(lastInbound);
  const risk = riskNow || (escalated && saysSelfHarm([modelOutcome.reason, ...recentInbound]));
  const clinical = escalated && modelOutcome.category === "clinical";
  const afterCallAsk =
    escalated &&
    input.stage === "tuvo_llamada" &&
    ["other", "unknown", "reschedule"].includes(modelOutcome.category) &&
    asksForMoreHelp(lastInbound);
  // Lo que ya decidió otra respuesta (la sesión urgente, el enlace, la comunidad, los datos, la cotización) va primero.
  const otherFallback = agendaOnly || chatLinkOnly || communityOnly || paymentDataOnly || Boolean(quotePay) || workshopOnly;
  // Solo lo que de verdad le llegaría: su respuesta, o el aviso de una escalada (no un comprobante recibido).
  const emergencyTalk =
    !input.clientMode &&
    !state.receipt &&
    !otherFallback &&
    givesEmergencyAdvice(modelOutcome.kind === "reply" ? modelOutcome.message : escalated ? state.holdingReply : null);
  if (emergencyTalk) log("emergency_advice", { auto: true }, { ok: true, note: "El modelo escribió una línea de emergencias o «urgencias»: no sale." });
  const serious =
    (risk || clinical || afterCallAsk || emergencyTalk) && !otherFallback
      ? (() => {
          const link = pickPaymentLink(chatLinks, input.memory);
          const reply = seriousReply({
            stage: input.stage ?? null,
            link,
            hasPaymentData: Boolean(chatPayInfo),
            priorAi: input.transcript.filter((l) => l.direction === "OUTBOUND" && l.isAutoReply && l.body).slice(-20).map((l) => l.body as string),
            canOfferFreeCall: salesOn && !upcomingCall,
            upcomingLabel: upcomingCall ? dualZoneLabel(upcomingCall.startsAt.toISOString(), personTz() ?? timezone, timezone) : null,
          });
          if (reply.attachLink && link) {
            state.paymentLink = link.url;
            log("send_payment_link", { auto: true, cual: link.label }, { ok: true, note: "Lo pegó el código: ya tuvo su llamada; lo siguiente con Dayana es después del pago." });
          }
          return reply.text;
        })()
      : null;
  // Dayana se entera de lo delicado, y de lo que el modelo le quería pasar cuando
  // su aviso traía emergencias; la persona no recibe «le aviso a Dayana».
  if (serious && (risk || clinical || (emergencyTalk && escalated))) {
    state.silentEscalation = {
      category: risk || clinical || modelOutcome.kind !== "escalate" ? "clinical" : modelOutcome.category,
      severity: "normal",
      reason:
        modelOutcome.kind === "escalate"
          ? modelOutcome.reason
          : `Escribió algo delicado: «${lastInbound.join(" ").slice(0, 150)}». La IA le contestó con apoyo.`,
    };
  }
  // Solo se inscribió al evento y aun así el modelo la mete en el embudo (la
  // llamada gratis, ¿cómo estás?, ¿de qué país?, ¿qué te motiva?) o no le da
  // la bienvenida a su «gracias»: sale la bienvenida al evento (Miroslava,
  // Ana, Caicedo, 22-oct).
  const guestFix =
    guestEvent && !serious && modelOutcome.kind === "reply" && modelOutcome.message.trim()
      ? guestReply(guestEvent, modelOutcome.message, lastInbound, input.transcript, {
          firstName: sureFirstName(nameInfo),
          timezone,
          now: now.getTime(),
        })
      : null;
  if (guestFix && modelOutcome.kind === "reply") {
    log("guest_reply", { auto: true }, { ok: true, replaced: modelOutcome.message, note: "Lo puso el código: solo se inscribió al evento y no pidió la llamada." });
  }
  const outcome: BrainOutcome = agendaOnly
    ? { kind: "reply", message: URGENT_SESSION_REPLY }
    : chatLinkOnly
      ? { kind: "reply", message: CHAT_LINK_REPLY }
      : communityOnly
        ? { kind: "reply", message: COMMUNITY_REPLY }
        : paymentDataOnly
          ? { kind: "reply", message: "Claro, te comparto los datos para el pago. Cuando lo hagas, me mandas el comprobante por aquí para que Dayana lo revise" }
          : quotePay
            ? { kind: "reply", message: quotePayReply({ name: sureFirstName(nameInfo), pack: quotePay.pack, what: quotePay.what }) }
            : workshopOnly && workshop
              ? {
                  kind: "reply",
                  message:
                    workshopFix === "link"
                      ? // Escaló una pregunta que solo Dayana sabe (la promoción, cuotas): el enlace y Dayana le contesta.
                        workshopLinkReply(workshop, { handoff: modelOutcome.kind === "escalate", promo: promoFix })
                      : workshopReply(workshop, { upcomingLabel: upcomingLabelText }),
                }
              : serious
                ? { kind: "reply", message: serious }
                : guestFix
                  ? { kind: "reply", message: guestFix }
                  : modelOutcome;
  // La sesión urgente escrita sin la herramienta (flash-lite copia el ejemplo
  // del prompt y se inventa «[Enlace de pago]»): si de verdad insistió, el
  // código pega el enlace como si la hubiera usado. Y nunca sale un enlace
  // inventado junto al de verdad.
  if (outcome.kind === "reply" && urgentPath && !state.urgentSession && offersUrgentSession(outcome.message)) {
    const url = absoluteUrl(urgentPath);
    const check = urgencyInsisted(input.transcript);
    if (check.insisted && !urgentLinkSent(input.transcript, url)) {
      addLink(url);
      addLink(urgentSessionAfter(config));
      state.urgentSession = { reason: "Insistió en hablar contigo hoy.", asks: check.asks };
      log("send_urgent_session_link", { auto: true }, { ok: true, note: "Lo pegó el código: la respuesta ofrecía la sesión sin la herramienta." });
    }
  }
  // El enlace de pago que Dayana le creó en el CRM: si el modelo lo vuelve a escribir, no es inventado.
  const crmPayUrl = input.contactId ? ((await activePaymentLinkFor(input.contactId).catch(() => null))?.url ?? null) : null;
  const replyText = (message: string) => {
    let text = state.urgentSession ? withoutHoyMismo(withoutFakeLinks(message) || message) : message;
    // La comunidad o el curso ofrecidos sin su herramienta (eval 21-oct: «aquí puedes
    // unirte a la comunidad», «[Enlace a la comunidad]»): si pidió entrar al grupo o
    // dijo que no le alcanza, el código pega el enlace de verdad y quita el inventado.
    const asked = foldForSearch(
      [...lastInbound, ...input.transcript.filter((l) => l.direction === "INBOUND").slice(-4).map((l) => l.body ?? "")].join(" ")
    );
    const wantsGroup = /\b(comunidad|grupo)\b/.test(asked);
    const cantAfford = /(no me alcanza|no tengo (como|con que|para|plata|dinero)|mal de plata|ahorr|esta caro|muy caro|econom|sin (plata|dinero))/.test(asked);
    // Un enlace de grupo escrito por el modelo («Https://chat.whatsapp.com/invitation»)
    // nunca sale: el de verdad lo pega el código.
    const typedGroup = /https?:\/\/chat\.whatsapp\.com\/[^\s)]*/gi;
    if (typedGroup.test(text)) {
      text = text.replace(typedGroup, "").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
      if (community && !state.links.includes(community)) {
        addLink(community);
        log("send_community_link", { auto: true }, { ok: true, note: "Lo pegó el código: el modelo escribió el enlace del grupo a mano." });
      }
    }
    // Pidió entrar a la comunidad y la respuesta es «Déjame consultarlo con Dayana»
    // (Ruth, 23-oct): entra con el enlace.
    if (community && !state.links.includes(community) && asksToJoinCommunity(lastInbound) && promisesHandoff(text)) {
      text = COMMUNITY_REPLY;
      addLink(community);
      log("send_community_link", { auto: true }, { ok: true, note: "Lo pegó el código: pidió entrar a la comunidad y la respuesta solo decía que lo consultaba." });
      // La respuesta prometía pasárselo a Dayana: se entera igual, sin que la persona lo vea.
      state.silentEscalation ??= {
        category: "other",
        severity: "normal",
        reason: `Pidió entrar a la comunidad («${lastInbound.join(" ").slice(0, 120)}»); la asistente le mandó el enlace.`,
      };
    }
    // El enlace del taller (dueña, 25-oct): escrito a mano por el modelo, o eligió
    // separar su cupo (o el modelo dice «aquí tienes el enlace») sin la herramienta.
    // Lo pega el código; sin la palabra «enlace» en el texto, va la respuesta del cupo.
    const typedWorkshop = withoutWorkshopPayUrls(text);
    if (typedWorkshop.had) text = typedWorkshop.text || text;
    // Eligió el cupo y el modelo le ofreció horas (eval 25-oct: «La primera» → horas
    // de la llamada): van el enlace y la respuesta del cupo, sin la lista.
    const spotOverSlots = workshopSpot && Boolean(state.slotOffer);
    // Al preguntar por primera vez, el enlace solo si ya eligió el cupo (si no, va la pregunta).
    const mayLink = workshopSpot || (workshopFlow && !workshopAskNow);
    if (
      workshop &&
      workshopPay &&
      mayLink &&
      !state.links.includes(workshopPay) &&
      (!state.slotOffer || spotOverSlots) &&
      !state.booking &&
      !state.pendingBooking &&
      !state.bookingNotice &&
      (typedWorkshop.had || workshopSpot || promisesWorkshopLink(text))
    ) {
      addLink(workshopPay);
      log("send_workshop_link", { auto: true }, { ok: true, note: "Lo pegó el código: eligió separar su cupo o la respuesta hablaba del enlace sin la herramienta." });
      // Si su texto ya habla del enlace, sale tal cual; si no (Sergio, 25-oct: «Dayana te
      // explica las formas de pago en la llamada»), la respuesta del cupo: sumarle el enlace
      // a otra cosa lo contradice.
      if (spotOverSlots) state.slotOffer = null;
      text =
        !spotOverSlots && /\b(enlace|link)\b/.test(foldForSearch(text)) ? withoutFakeLinks(text) || text : workshopLinkReply(workshop);
    }
    // Eligió el cupo, va el enlace y el texto le vuelve a preguntar (eval 25-oct: «La
    // primera» + el enlace + «¿desde qué país me escribes?»): la respuesta del cupo.
    // Y si escribió la herramienta como texto («default_api:send_workshop_link{}», eval 25-oct),
    // run.ts lo quitaría todo y llegaría solo el enlace: la respuesta del cupo.
    if (workshop && workshopPay && state.links.includes(workshopPay) && ((workshopSpot && /\?/.test(text)) || withoutToolText(text).had)) {
      text = workshopLinkReply(workshop);
    }
    // Ningún enlace que no leyó en una fuente de verdad (Ruth, 23-oct: «…/comunidad»,
    // que no existe): las reglas, los DATOS, las notas, lo que escribieron Dayana o
    // la persona y los envíos automáticos. No lo que escribió antes la IA (ahí está
    // el de Ruth), ni la ficha, ni los ejemplos de otros chats.
    const aiWrote = (l: TranscriptLine) => l.direction === "OUTBOUND" && ((Boolean(l.isAutoReply) && !l.source) || l.source === "approval");
    const trusted = [...input.transcript, ...(input.olderSnippets ?? [])].filter((l) => !aiWrote(l)).map((l) => l.body);
    const invented = withoutInventedUrls(
      text,
      urlKeys(
        system,
        [dossierPart, snippetsPart, examplesPart, transcriptPart].reduce<string>((t, part) => (part ? t.split(part).join("") : t), promptText),
        ...trusted,
        ...state.links,
        state.paymentLink,
        ...chatLinks.map((l) => l.url),
        // Los que el código pega (de Ajustes y del CRM), aunque la IA los haya mandado antes.
        community,
        ...options.map((o) => absoluteUrl(o.url)),
        urgentPath ? absoluteUrl(urgentPath) : null,
        crmPayUrl,
        workshopPay
      ),
      siteHosts()
    );
    if (invented.removed.length) {
      text = invented.text;
      log("invented_link", { auto: true }, { ok: true, removed: invented.removed, note: "El modelo escribió un enlace que no existe en ninguna parte: no salió." });
    }
    // La cuenta copiada a mano del chat (ENNY, 23-oct): si cada número es el de
    // unos datos de verdad, va el bloque; si no, el freno de run.ts la para.
    if (!state.urgentSession) {
      const typed = typedPaymentData(text, [
        ...methods.map((m) => ({ details: m.details, exact: true })),
        ...dayanaPaymentDataBodies(input.transcript, now).map((details) => ({ details, exact: false })),
      ]);
      if (typed) {
        text = typed.text;
        if (!state.paymentDetails.includes(typed.block)) state.paymentDetails.push(typed.block);
        log("send_payment_info", { auto: true }, { ok: true, note: "Lo pegó el código: el modelo copió a mano los datos del chat y cada número es el de verdad." });
      }
    }
    const offers = foldForSearch(text);
    if (community && !state.links.includes(community) && /\bcomunidad\b/.test(offers) && (wantsGroup || cantAfford)) {
      addLink(community);
      log("send_community_link", { auto: true }, { ok: true, note: "Lo pegó el código: la respuesta ofrecía la comunidad sin la herramienta." });
      text = withoutFakeLinks(text) || text;
    }
    const cheaper = options[0];
    if (cheaper && cantAfford && /\bcurso\b/.test(offers) && !state.links.includes(absoluteUrl(cheaper.url))) {
      addLink(absoluteUrl(cheaper.url));
      log("send_affordable_option", { option: cheaper.key, auto: true }, { ok: true, label: cheaper.label, note: "Lo pegó el código: la respuesta ofrecía el curso sin la herramienta." });
      text = withoutFakeLinks(text) || text;
    }
    // «Te comparto los datos de Bancolombia…» sin send_payment_info (eval ENNY, 21-oct):
    // le llegaba la promesa sin los datos. Con las mismas reglas que la herramienta,
    // el código pega la forma de pago que nombra (o la única que hay).
    if (
      methods.length > 0 &&
      state.paymentDetails.length === 0 &&
      !state.paymentLink &&
      !chatLink &&
      !chatPayInfo &&
      /\b(te comparto|aqui (tienes|van|te dejo)|te paso|te envio) (los |las )?(datos|cuenta|cuentas)\b/.test(foldForSearch(text))
    ) {
      const named = methods.find((m) => foldForSearch(text).includes(foldForSearch(m.label))) ?? (methods.length === 1 ? methods[0] : null);
      if (named) {
        state.paymentDetails.push(named.details);
        log("send_payment_info", { method: named.key, auto: true }, { ok: true, label: named.label, note: "Lo pegó el código: la respuesta prometía los datos sin la herramienta." });
      }
    }
    // El enlace de Dayana copiado a mano: lo pega el código debajo, como send_payment_link.
    if (!chatLink || state.urgentSession) return text;
    const copied = withoutPayUrls(text);
    // «Puedes pagar por el enlace que te envió Dayana» sin la herramienta: se le vuelve a poner.
    // Después de la cotización también «el pago del paquete de tres sesiones que te
    // envió» (Joselyn, eval 23-oct). Con otro enlace ya pegado (el curso, la
    // comunidad) no se agrega el de Dayana.
    // Nunca debajo del aviso de un comprobante («Dayana revisa el pago de tus 3 sesiones»): pagaría dos veces.
    const folded = foldForSearch(text);
    const talksOfDayanaLink =
      !state.receipt &&
      !lastInboundMedia &&
      /\bpag/.test(folded) &&
      (/\b(enlace|link)\b/.test(folded) || (Boolean(quoteSit) && (/\bque te (envio|mando|compartio|paso)\b/.test(folded) || askedPackage(text) !== null)));
    // Hablando del taller, «el enlace de pago» es el del taller (eval 25-oct: a la pregunta
    // del cupo o la llamada se le pegaba el enlace del paquete de Naty).
    const workshopTalk = Boolean(workshop) && (workshopAskNow || workshopFlow);
    if (!copied.had && (state.links.length > 0 || !talksOfDayanaLink || workshopTalk)) return text;
    if (!state.paymentLink) {
      // El que copió, el del paquete que nombra, el de las notas de Dayana o el último.
      const pick =
        chatLinks.find((l) => text.includes(l.url)) ?? pickPaymentLink(chatLinks, askedPackage(text) !== null ? text : input.memory) ?? chatLink;
      state.paymentLink = pick.url;
      log("send_payment_link", { auto: true, cual: pick.label }, { ok: true, note: "Lo pegó el código: la respuesta hablaba del enlace de Dayana sin la herramienta." });
    }
    // Y sin «*(El enlace de pago aparecerá aquí)*» ni «[Enlace]» inventados al lado del de verdad.
    const clean = copied.had ? copied.text || text : text;
    return withoutFakeLinks(clean) || clean;
  };
  // Ningún nombre que no sea seguro, aunque el modelo lo escriba (lo que recibe la persona).
  const named = (text: string | null) => (text ? fixNameInReply(text, nameInfo) : text);
  // Pidió cómo pagar lo cotizado y va el enlace o los datos: con «Recuerda que con
  // Dayana quedaron en…» y el comprobante (dueña, 23-oct). No si pide otro paquete.
  // El paquete del enlace que de verdad va debajo (si es de Dayana), si no el de las notas.
  const reminded = (text: string) => {
    if (!quoteSit || !asksHowToPay(lastInbound) || askedPackage(lastInbound.join(" ")) !== null) return text;
    if (!state.paymentLink && state.paymentDetails.length === 0) return text;
    const attached = state.paymentLink ? chatLinks.find((l) => l.url === state.paymentLink) : null;
    const pack = attached ? (/\/therapy-\d+/i.test(attached.url) ? attached.label : null) : state.paymentLink ? null : quotePack;
    return withQuoteReminder(text, pack);
  };
  // Dijo que sí a la llamada gratis y el modelo le preguntó qué día prefiere, o el país
  // otra vez, sin buscar horas (Moi, Belén, Ana, 21–26 oct: nunca les llegaron). Las
  // busca el código, como la herramienta (con los días o la franja que dijo ahora), y
  // la lista va debajo de su frase. Si la agenda no da horas (sin zona, falta la
  // ciudad), queda la respuesta del modelo.
  // También si Google bloqueó el pedido dos veces (Adrienne, 26-oct: dijo «solo de noche a
  // las 20:00» y cada mensaje suyo terminaba en «Déjame consultarlo con Dayana»).
  let autoOffered = false;
  if (
    outcome === modelOutcome &&
    (outcome.kind === "reply" || Boolean(blockedBy)) &&
    salesOn &&
    !guestEvent &&
    !upcomingCall &&
    !serious &&
    !workshopSpot &&
    !state.slotOffer &&
    !state.booking &&
    !state.pendingBooking &&
    !state.bookingNotice &&
    !state.bookingRequest &&
    !state.keepsCall &&
    !state.urgentSession &&
    !state.receipt &&
    !toolCalls.some((c) => c.tool === "offer_free_call_slots" || c.tool === "book_free_call") &&
    acceptedCallWithoutHours(input.transcript)
  ) {
    // Cuándo dijo que puede en sus últimos mensajes (lo último manda; no lo de las sesiones).
    await offerSlots(availabilityArgs(input.transcript.filter((l) => l.direction === "INBOUND").slice(-6).map((l) => l.body ?? "")));
    autoOffered = Boolean(state.slotOffer);
    // En el rastro, como la herramienta (con sus horas: «2» se agenda igual), marcada como del código.
    const entry = toolCalls.at(-1);
    if (entry?.tool === "offer_free_call_slots") entry.input = { ...(entry.input as object), auto: true };
  }
  // Agendada o movida: la confirmación del código, con la hora de la reserva.
  // Horas ofrecidas: la frase del modelo y debajo la lista numerada del código.
  // (No se vuelve a listar horas si en esta vuelta agendar dijo que ya tiene
  // su llamada o no la pudo mover: revisión 21-oct.)
  const withAgenda = (text: string) =>
    state.bookingNotice
      ? state.bookingNotice.text
      : state.slotOffer && !state.booking && !state.pendingBooking && !state.keepsCall
        ? offerMessage(autoOffered ? leadBeforeHours(text) : text, state.slotOffer.options, state.slotOffer.matchedWish)
        : text;
  // Preguntó por el taller y contesta el modelo: siempre «abierto» y la llamada
  // para inscribirse (dueña, 24-oct; el modelo daba la información y se las saltaba);
  // con enlace de pago, la pregunta del cupo o la llamada (25-oct). No encima de
  // las horas o la cita que ya le dio (eligió la llamada).
  const withWorkshop = (text: string) =>
    workshop &&
    workshopAskNow &&
    outcome === modelOutcome &&
    !state.bookingNotice &&
    (!workshopPay || (!state.slotOffer && !state.booking && !state.pendingBooking))
      ? withWorkshopStep(text, workshop, { upcomingLabel: upcomingLabelText, linkSent: Boolean(workshopPay && state.links.includes(workshopPay)) })
      : text;
  // Lo delicado sale tal cual (apoyo o el paso del pago), sin la lista de horas.
  // Bloqueado y con horas del código: sale la lista (con la frase de siempre), no «Déjame consultarlo».
  const answered: BrainOutcome = autoOffered && outcome.kind === "escalate" ? { kind: "reply", message: "" } : outcome;
  const shaped: BrainOutcome =
    answered.kind === "reply"
      ? { ...answered, message: serious ? answered.message : withAgenda(withWorkshop(reminded(named(replyText(answered.message))!))) }
      : answered;
  // Dayana le escribió hace un momento y la persona le contesta a ella: esa
  // conversación es de Dayana (Raquel, 22-oct: a su respuesta al audio de
  // Dayana la IA metió «Quedamos listas…» encima). La IA no se mete, salvo con
  // lo que ella resuelve: datos o enlace de pago, el comprobante, la agenda.
  // Si pregunta algo, contesta (puede ser que Dayana no esté mirando).
  const dayanaAt = (() => {
    let i = input.transcript.length;
    while (i > 0 && input.transcript[i - 1].direction === "INBOUND") i--;
    return i > 0 ? input.transcript[i - 1].sentAt : undefined;
  })();
  const stepAside =
    toDayana &&
    !askedSomething &&
    !input.clientMode &&
    Boolean(dayanaAt && now.getTime() - dayanaAt.getTime() < 30 * 60_000) &&
    shaped.kind === "reply" &&
    Boolean(shaped.message.trim()) &&
    !serious &&
    !state.receipt &&
    !state.booking &&
    !state.pendingBooking &&
    !state.bookingNotice &&
    !state.urgentSession &&
    state.paymentDetails.length === 0 &&
    !state.paymentLink &&
    state.links.length === 0;
  if (stepAside && shaped.kind === "reply") {
    state.noReply = "Dayana le escribió hace un momento y le está contestando a ella.";
    log("no_reply", { auto: true }, { ok: true, replaced: shaped.message, note: "Lo decidió el código: Dayana está en la conversación." });
  }
  const finalOutcome: BrainOutcome = stepAside ? { kind: "reply", message: "" } : shaped;

  return {
    outcome: finalOutcome,
    examples,
    toolCalls,
    stickerUrl: finalOutcome.kind === "reply" ? state.stickerUrl : null,
    booking: state.booking,
    pendingBooking: finalOutcome.kind === "reply" ? state.pendingBooking : null,
    pendingPayment: finalOutcome.kind === "reply" ? state.pendingPayment : null,
    bookingRequest: finalOutcome.kind === "reply" ? state.bookingRequest : null,
    pendingSlots: finalOutcome.kind === "reply" ? state.pendingSlots : null,
    suggestedReply: finalOutcome.kind === "escalate" ? named(state.suggestedReply) : null,
    holdingReply: finalOutcome.kind === "escalate" ? named(state.holdingReply) : null,
    paymentBlocks: finalOutcome.kind === "reply" ? { details: state.paymentDetails, link: state.paymentLink } : { details: [], link: null },
    linkBlocks: finalOutcome.kind === "reply" ? state.links : [],
    urgentSession: finalOutcome.kind === "reply" ? state.urgentSession : null,
    receipt: state.receipt,
    noReply: state.noReply,
    slotOffer: finalOutcome.kind === "reply" ? state.slotOffer : null,
    bookingNotice: state.bookingNotice,
    silentEscalation: state.silentEscalation,
    serious: Boolean(serious),
    model: modelId(),
    usage: {
      inputTokens: result.totalUsage?.inputTokens ?? undefined,
      cachedTokens: result.totalUsage?.inputTokenDetails?.cacheReadTokens ?? undefined,
      outputTokens: result.totalUsage?.outputTokens ?? undefined,
    },
  };
};
