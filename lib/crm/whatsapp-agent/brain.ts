import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { appointmentsFor, confirmAppointment } from "./appointments";
import { contactStage } from "../contact-stage";
import { getOperationalTimezone } from "../operational-timezone";
import { Prisma } from "@prisma/client";
import { generateText, hasToolCall, isStepCount, tool } from "ai";
import { z } from "zod";

import { prisma } from "@/lib/db";
import { BRAND } from "@/lib/contact";
import { getSiteUrl } from "@/lib/site-url";
import { getDateKeyInTz, getTimeHmInTz, zonedDateTimeToUtc } from "@/lib/datetime/zoned-time";
import type { WhatsAppAiConfig } from "../whatsapp-ai-config";
import { findSimilarExamples, type SimilarExample } from "../whatsapp-learning";
import { availableSlots, SlotUnavailableError } from "./calendar";
import { diagnosticContextFor } from "../diagnostic-context";
import { playbooksBlock } from "./playbooks";
import { spreadSlots } from "./slots";
import { PAYMENT_PLACEHOLDER } from "./placeholders";

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
  } | null;
  /** Enlace de pago que la IA quiere mandar: espera la autorización de Dayana. */
  pendingPayment: { productId: string; product: string } | null;
  /** Horas que la IA quiere ofrecer: Dayana las aprueba (o cambia) antes de que salgan. */
  pendingSlots: { service: string; options: { startIso: string; label: string }[] } | null;
  /** En un pago ya hecho: lo que Dayana puede responder cuando lo verifique. */
  suggestedReply: string | null;
  model: string;
  usage: { inputTokens?: number; outputTokens?: number };
};

export type TranscriptLine = {
  direction: "INBOUND" | "OUTBOUND";
  body: string | null;
  /** «imagen», «audio»… si trae adjunto. */
  attachment?: string | null;
  isAutoReply?: boolean;
};

/** El modelo a veces escribe en Markdown; WhatsApp usa *un* asterisco para negrita. */
export const toWhatsAppFormat = (text: string): string =>
  text
    .trim()
    .replace(/\*\*(.+?)\*\*/g, "*$1*")
    .replace(/__(.+?)__/g, "_$1_")
    .replace(/^#{1,6}\s+/gm, "");

export const modelId = () => process.env.GEMINI_MODEL?.trim() || "gemini-3.5-flash";

const google = createGoogleGenerativeAI({
  apiKey: process.env.GEMINI_API_KEY?.trim(),
});

const money = (currency: string, minor: number) =>
  currency === "COP"
    ? `${minor.toLocaleString("es-CO")} COP`
    : `${(minor / 100).toFixed(2)} USD`;

/** Lo único que la IA puede afirmar: sale del CRM en cada respuesta. */
export const businessFacts = async (config: WhatsAppAiConfig): Promise<string> => {
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
        prices: {
          orderBy: { validFrom: "desc" },
          select: { currency: true, amountMinor: true },
        },
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
        product: {
          select: {
            prices: { orderBy: { validFrom: "desc" }, select: { currency: true, amountMinor: true } },
          },
        },
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
    "PAQUETES ACTIVOS (precio exacto, no lo cambies ni lo redondees):",
    ...products.map((p) => {
      const price = p.prices
        .filter((x, i, all) => all.findIndex((y) => y.currency === x.currency) === i)
        .map((x) => money(x.currency, x.amountMinor))
        .join(" · ");
      return `- ${p.title}${p.sessionsLabel ? ` (${p.sessionsLabel})` : ""}: ${price || "sin precio publicado"}`;
    }),
    "",
    `Para pagar cualquier terapia: ${site}/pagar/terapias`,
    `Cuestionario gratis (3 min, dice qué proceso le sirve): ${site}/terapias/empezar`,
  ];

  if (config.booking.enabled) {
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
    const price = (w.product?.prices ?? [])
      .filter((x, i, all) => all.findIndex((y) => y.currency === x.currency) === i)
      .map((x) => money(x.currency, x.amountMinor))
      .join(" · ");
    const date = w.dateLabel || when(w.startsAt);
    lines.push(
      `- ${w.title}${date ? ` — ${date}` : ""}${w.scheduleLabel ? ` (${w.scheduleLabel})` : ""}${
        w.status === "OPEN" ? " — INSCRIPCIONES ABIERTAS" : ` — ${w.status === "CLOSED" ? "inscripciones cerradas" : "próximamente"}`
      }${price ? ` — ${price}` : ""}. Página: ${site}/taller-virtual/${w.slug}${w.cardSummary ? `\n  De qué trata: ${w.cardSummary}` : ""}`
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
  phone?: string | null
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
  if (!contact && !next && !last) return null;

  const tz = await getOperationalTimezone().catch(() => "America/Bogota");
  const when = (d: Date) =>
    new Intl.DateTimeFormat("es-CO", { timeZone: tz, weekday: "long", day: "numeric", month: "long", hour: "numeric", minute: "2-digit" }).format(d);
  const enrollments = contact?.enrollments ?? [];
  const stage = contactStage({
    enrollments: enrollments.map((e) => ({ status: e.status, sessionsUsed: e.sessionsUsed, sessionsTotal: e.sessionsTotal, product: e.product.title })),
    nextAppointment: next ? { startsAt: next.startsAt, sessionsLabel: next.sessionsLabel } : null,
    lastAppointment: last ? { startsAt: last.startsAt } : null,
    hasDiagnostic: (contact?._count.diagnostics ?? 0) > 0,
  });

  const lines: string[] = [];
  if (contact) lines.push(`Nombre: ${[contact.firstName, contact.lastName].filter(Boolean).join(" ") || "sin nombre"}`);
  lines.push(`Etapa: ${stage.label}`);
  if (next) {
    lines.push(
      `Próxima cita: ${when(next.startsAt)}${next.sessionsLabel && next.sessionsLabel !== "0/0" ? ` (sesión ${next.sessionsLabel})` : " (llamada gratis)"}${next.confirmedAt ? " · ya confirmó" : next.reminderSentAt ? " · se le mandó el recordatorio, aún no confirma" : ""}. Si la persona confirma («sí», «ahí estaré»), usa confirm_appointment.`
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
  return lines.join("\n");
};

const IDENTITY: Record<WhatsAppAiConfig["identity"], string> = {
  assistant:
    "Escribes DE PARTE de Dayana, no eres ella: habla de Dayana en tercera persona («Dayana te responde», «ella revisa»). No te presentes como robot salvo que te lo pregunten directamente; si te lo preguntan, dilo con naturalidad.",
  owner:
    "Escribes en primera persona, con la voz de Dayana, porque es su número. Si la persona pregunta si habla con un robot o una IA, no lo niegues: di con naturalidad que es una respuesta automática y escala.",
};

const systemPrompt = (config: WhatsAppAiConfig, now: string): string => {
  const parts = [
    `Contestas el WhatsApp de ${BRAND.name}. Lo más importante: escribir COMO ESCRIBE DAYANA. Sus ejemplos reales y su guía de estilo (más abajo) mandan sobre cualquier otra indicación de tono: largo de los mensajes, saludos, forma de tratar, palabras que usa, emojis. Si no hay ejemplos: cercana, en español, de tú, mensajes cortos (2 o 3 frases).

Ahora es ${now}.

Cómo conversas (así vende Dayana):
- Género: antes de usar cualquier palabra con género o apodo cariñoso, decide si hablas con un hombre o una mujer por su nombre y por cómo habla de sí. Con un hombre usa siempre masculino («querido», «bienvenido», «te bendigo»); JAMÁS «mi bella», «mi hermosa», «querida» ni adjetivos femeninos. Si no puedes saberlo, usa solo su nombre y frases sin género.
- Saluda solo en tu primer mensaje de la conversación; después sigue la charla sin volver a decir «Hola» ni repetir el apodo en cada respuesta.
- Primero la persona, no el precio. Saluda con calidez y pregúntale cómo está, qué la trae, qué está viviendo.
- Haz una o dos preguntas que la hagan mirar su situación, una a la vez: «¿hace cuánto te sientes así?», «¿cómo te está afectando en tu día a día?», «¿cuánto tiempo más quieres seguir viviendo esto?». Refleja en una frase lo que te cuenta, con empatía, sin dar consejos ni diagnosticar.
- El objetivo con quien escribe por primera vez es casi siempre la CONSULTA GRATIS DE 15 MINUTOS con Dayana: invítala («Dayana tiene un espacio gratuito de 15 minutos para escucharte y decirte qué proceso te sirve, ¿te lo agendo?»). Si no quiere hablar de lo que vive, invítala directo a la consulta.
- Precios: no los des de entrada. Si los pide, primero ofrece la consulta gratis («ahí Dayana te dice cuál proceso te conviene»); si insiste, da el precio exacto de los DATOS.
- Pago: solo si pide cómo pagar o quiere pagar un paquete, usa payment_link con ese paquete y comparte el enlace.
- AGENDAS tú misma en el Google Calendar de Dayana (nunca mandes enlaces para que agende sola): usa check_availability con la duración del servicio${config.booking.approveSlots ? " y luego offer_times con 2 o 3 opciones: Dayana las aprueba antes de que salgan, y tu mensaje lleva {{HORARIOS}} donde van (no las escribas tú). Cuando la persona elija una de las horas que ya se le enviaron," : " y ofrece 2 o 3 opciones concretas. Cuando elija,"} CONFIRMA repitiendo servicio, día y hora («¿Te agendo la consulta el jueves 25 a las 3:00 p. m.?»). Solo con su «sí», usa book_appointment y comparte día, hora y el enlace de Meet. Si no sabes su nombre, pídeselo antes de agendar. Las horas son de Colombia; si el número no es de Colombia (+57), aclara «hora de Colombia».
- Con clientas que ya conocen a Dayana, usa la CONVERSACIÓN, la MEMORIA y CLIENTA EN EL CRM para dar continuidad (su próxima sesión, su paquete) sin preguntar lo que ya se habló.
- Talleres, webinars, masterclass y eventos gratuitos: tú SÍ sabes cuáles hay, están en los DATOS (TALLERES y EVENTOS GRATUITOS). Si preguntan, di cuál hay, cuándo, cómo es y comparte el enlace de inscripción. Si no hay ninguno próximo, dilo con naturalidad, cuéntale que Dayana los anuncia por aquí y ofrécele la consulta gratis de 15 minutos. Nunca le preguntes a la persona qué eventos hay ni le digas que no sabes.
- Si dudas cómo lo diría Dayana, usa search_past_chats.

Llama a escalate (y NO escribas ningún mensaje) cuando:
- category=payment: menciona un pago YA hecho, una transferencia, manda un comprobante (MIRA las imágenes adjuntas: si es un comprobante, transferencia o recibo, es esto), pregunta por un cobro, un reembolso o una factura, o pide un descuento. (Pedir cómo pagar NO es esto: para eso está payment_link.)
- category=unknown: pregunta algo que no está en los DATOS ni en la conversación, o no entiendes el mensaje (una imagen que no sabes interpretar, un audio marcado «(inaudible)»).
- Las fotos y stickers que mandó la persona van adjuntos como imágenes: míralos y responde a lo que muestran (una captura de un horario, una foto de algo que le pasa, un sticker de cariño…). Nunca digas que no puedes ver imágenes. Las notas de voz llegan transcritas con 🎤 delante: léelas como si te las hubiera escrito.
- category=reschedule: quiere cambiar o cancelar una cita ya agendada.
- category=complaint: se queja o está molesta.
- category=clinical: cuenta una crisis o un dolor emocional fuerte, o pide ayuda psicológica. Si menciona hacerse daño, severity=urgent.
- category=other: Dayana prometió algo en la conversación que tú no puedes cumplir con los DATOS.

${IDENTITY[config.identity]}

Prohibido siempre: dar consejo clínico o diagnóstico, prometer resultados, inventar precios, fechas, horarios o enlaces, confirmar un pago, pedir datos de tarjeta o contraseñas, hablar de otra cosa que no sea este negocio.

Tu respuesta final (si no escalas) es EXACTAMENTE el mensaje de WhatsApp que se envía, sin comillas ni explicaciones. Formato de WhatsApp: negrita con *un asterisco*, nunca **dos**, ni títulos con #, ni tablas.`,
  ];
  if (config.styleGuide) parts.push(`CÓMO ESCRIBE DAYANA (imítalo):\n${config.styleGuide}`);
  if (config.instructions) {
    parts.push(
      `INSTRUCCIONES DE DAYANA (cúmplelas, salvo que choquen con lo prohibido):\n${config.instructions}`
    );
  }
  return parts.join("\n\n");
};

const examplesBlock = (examples: SimilarExample[]): string | null =>
  examples.length === 0
    ? null
    : [
        "EJEMPLOS REALES de cómo contestó Dayana a mensajes parecidos. Imita su forma. Los precios, fechas, enlaces u ofertas que aparezcan pueden estar viejos: esos datos salen solo de los DATOS.",
        ...examples.map((e, i) => `#${i + 1}\nPERSONA: ${e.clientText}\nDAYANA: ${e.replyText}`),
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
  return `${day}, ${getTimeHmInTz(d, timezone)}`;
};

/** Búsqueda literal en lo que Dayana ha escrito (complementa los vectores). */
const searchDayanaReplies = async (query: string): Promise<string[]> => {
  const rows = await prisma.$queryRaw<{ body: string }[]>(Prisma.sql`
    SELECT body FROM conversation_messages
    WHERE direction = 'OUTBOUND' AND is_auto_reply = false AND body IS NOT NULL
      AND to_tsvector('spanish', body) @@ plainto_tsquery('spanish', ${query})
    ORDER BY sent_at DESC
    LIMIT 5`);
  return rows.map((r) => r.body.slice(0, 500));
};

export type BrainInput = {
  config: WhatsAppAiConfig;
  transcript: TranscriptLine[];
  name: string | null;
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
  const toolCalls: BrainResult["toolCalls"] = [];
  // En un objeto y no en `let`: las tools lo escriben desde closures y TS no
  // ensancharía el tipo de una variable ya estrechada a null.
  const state: {
    outcome: BrainOutcome | null;
    booking: BrainBooking | null;
    stickerUrl: string | null;
    pendingBooking: BrainResult["pendingBooking"];
    pendingPayment: BrainResult["pendingPayment"];
    pendingSlots: BrainResult["pendingSlots"];
    suggestedReply: string | null;
  } = {
    outcome: null,
    booking: null,
    stickerUrl: null,
    pendingBooking: null,
    pendingPayment: null,
    pendingSlots: null,
    suggestedReply: null,
  };
  // Las horas que devolvió check_availability en esta vuelta (offer_times solo acepta estas).
  const seenOptions = new Map<string, string>();

  // Los stickers que Dayana usa de verdad (al menos dos veces), con lo que
  // suele escribir antes de mandarlos.
  const { listDayanaStickers } = await import("./workspace");
  const stickers = (await listDayanaStickers(20).catch(() => [])).filter((s) => s.uses >= 2).slice(0, 12);

  const lastInbound: string[] = [];
  for (const m of [...input.transcript].reverse()) {
    if (m.direction !== "INBOUND") break;
    if (m.body?.trim()) lastInbound.unshift(m.body.trim());
  }
  const examples = config.learning.enabled
    ? await findSimilarExamples(lastInbound.join("\n"), config.learning.examples).catch(
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

  const tools = {
    confirm_appointment: tool({
      description:
        "La persona confirma que asistirá a su próxima cita (responde sí al recordatorio). Márcala como confirmada y agradécele en tu respuesta.",
      inputSchema: z.object({}),
      execute: async () => {
        if (input.mode !== "live") return log("confirm_appointment", {}, { ok: true, preview: true });
        const { next } = await appointmentsFor({ contactId: input.contactId, phone: input.phone });
        if (!next) return log("confirm_appointment", {}, { ok: false, reason: "No tiene cita próxima." });
        await confirmAppointment(next.id);
        return log("confirm_appointment", {}, { ok: true, cita: next.startsAt.toISOString() });
      },
    }),
    escalate: tool({
      description:
        "Pasa el chat a Dayana y no contestes nada. Úsalo en pagos, preguntas que no están en los DATOS, cambios de cita, quejas o temas clínicos.",
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
      }),
      execute: async ({ suggestedReply, ...args }) => {
        state.outcome = { kind: "escalate", ...args };
        if (suggestedReply?.trim()) state.suggestedReply = suggestedReply.trim();
        return log("escalate", { ...args, suggestedReply }, { ok: true });
      },
    }),
    ...(config.booking.enabled
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
    payment_link: tool({
      description:
        "Crea el enlace de pago de un paquete de los DATOS, solo cuando la persona pide cómo pagar o quiere pagar. Devuelve la URL para compartirla tal cual.",
      inputSchema: z.object({
        product: z.string().describe("Nombre del paquete tal como aparece en los DATOS."),
      }),
      execute: async ({ product }) => {
        const site = getSiteUrl();
        const products = await prisma.product.findMany({
          where: { isActive: true, OR: [{ isCourseContent: false }, { sellsStandalone: true }] },
          select: { id: true, title: true },
        });
        const norm = (v: string) => v.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().trim();
        const match =
          products.find((p) => norm(p.title) === norm(product)) ??
          products.find((p) => norm(p.title).includes(norm(product)) || norm(product).includes(norm(p.title)));
        if (!match) {
          return log("payment_link", { product }, {
            url: `${site}/pagar/terapias`,
            note: "No encontré ese paquete exacto: este enlace muestra todos los paquetes.",
          });
        }
        if (input.mode === "preview" || !input.conversationId) {
          return log("payment_link", { product }, { url: `${site}/pagar/(enlace-de-prueba)`, product: match.title });
        }
        state.pendingPayment = { productId: match.id, product: match.title };
        return log("payment_link", { product }, {
          url: PAYMENT_PLACEHOLDER,
          product: match.title,
          note: `Escribe ${PAYMENT_PLACEHOLDER} exactamente donde va el enlace. Dayana lo autoriza y el enlace real se pone solo.`,
        });
      },
    }),
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
          examples: similar.map((e) => ({ persona: e.clientText, dayana: e.replyText })),
          dayanaWrote: literal,
        });
      },
    }),
  };

  const nowLabel = `${new Intl.DateTimeFormat("es-CO", { timeZone: timezone, weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(now)}, ${getTimeHmInTz(now, timezone)} (${timezone}, fecha ${getDateKeyInTz(now, timezone)})`;

  const promptText = [
      `DATOS (lo único que puedes afirmar):\n${await businessFacts(config)}`,
      await playbooksBlock().catch(() => null),
      input.client ? `CLIENTA EN EL CRM:\n${input.client}` : null,
      input.memory ? `MEMORIA (lo que sabemos de esta persona):\n${input.memory}` : null,
      examplesBlock(examples),
      stickers.length > 0
        ? `STICKERS DE DAYANA (usa send_sticker con el número; cuándo los manda ella):\n${stickers
            .map((st, i) => `${i + 1}. usado ${st.uses} veces; lo manda después de: ${st.contexts.map((c) => `«${c}»`).join(" / ") || "(sin texto antes)"}`)
            .join("\n")}`
        : null,
      input.name ? `La persona se llama ${input.name}.` : "No sabemos su nombre.",
      `Su número: +${input.phone}`,
      `CONVERSACIÓN (lo último abajo):\n${input.transcript.map(describeLine).join("\n")}`,
      input.images?.length
        ? `IMÁGENES: van adjuntas las ${input.images.length} últimas fotos o stickers que mandó la persona (la más reciente primero). Míralas.`
        : null,
    ]
      .filter(Boolean)
      .join("\n\n");

  const result = await generateText({
    model: google(modelId()),
    system: systemPrompt(config, nowLabel),
    ...(input.images?.length
      ? {
          messages: [
            {
              role: "user" as const,
              content: [
                { type: "text" as const, text: promptText },
                ...input.images.map((img) => ({ type: "image" as const, image: img.data, mediaType: img.mediaType })),
              ],
            },
          ],
        }
      : { prompt: promptText }),
    tools,
    stopWhen: [isStepCount(6), hasToolCall("escalate")],
  });

  const finalOutcome: BrainOutcome =
    state.outcome ??
    (result.text.trim()
      ? { kind: "reply", message: toWhatsAppFormat(result.text).slice(0, 1500) }
      : {
          kind: "escalate",
          category: "unknown",
          severity: "normal",
          reason: "El asistente no supo qué contestar.",
        });

  return {
    outcome: finalOutcome,
    examples,
    toolCalls,
    stickerUrl: finalOutcome.kind === "reply" ? state.stickerUrl : null,
    booking: state.booking,
    pendingBooking: finalOutcome.kind === "reply" ? state.pendingBooking : null,
    pendingPayment: finalOutcome.kind === "reply" ? state.pendingPayment : null,
    pendingSlots: finalOutcome.kind === "reply" ? state.pendingSlots : null,
    suggestedReply: finalOutcome.kind === "escalate" ? state.suggestedReply : null,
    model: modelId(),
    usage: {
      inputTokens: result.totalUsage?.inputTokens ?? undefined,
      outputTokens: result.totalUsage?.outputTokens ?? undefined,
    },
  };
};
