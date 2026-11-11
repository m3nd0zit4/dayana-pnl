import type { ContactSource } from "@prisma/client";

/**
 * El embudo de la llamada gratis en la web (`/llamada`): las reglas, sin base
 * de datos ni red. Lo que hace cada paso está en `server.ts`. Este archivo lo
 * importan también los componentes del navegador: nada de Prisma ni de Node.
 *
 * 1. Datos: nombre y WhatsApp (se guarda al instante: quien no termina igual
 *    queda como contacto para que Dayana le haga seguimiento).
 * 2. Preguntas: qué quiere trabajar y con qué urgencia. Cortas y opcionales en
 *    lo personal: lo que alguien cuente de su vida es un dato sensible.
 * 3. Hora: pocas horas, cercanas (entre más lejos la cita, menos gente llega),
 *    en la zona de la persona.
 *
 * La cita es la misma llamada gratis de 15 minutos que agenda la asistente de
 * WhatsApp: Dayana llama por WhatsApp, no hay enlace de videollamada.
 */

// ── Paso 1: datos ───────────────────────────────────────────────────────────

/** De dónde llegó. Todo opcional y recortado: viene de la URL, que escribe cualquiera. */
export type Attribution = {
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
};

export const EMPTY_ATTRIBUTION: Attribution = {
  utmSource: null,
  utmMedium: null,
  utmCampaign: null,
  utmContent: null,
  utmTerm: null,
  fbclid: null,
  ttclid: null,
  gclid: null,
  ref: null,
  referrer: null,
  landingPath: null,
};

const clip = (value: unknown, max: number): string | null => {
  if (typeof value !== "string") return null;
  // Sin caracteres de control: esto termina en el CRM y en notas.
  const clean = value.replace(/[\u0000-\u001f\u007f]/g, " ").trim();
  return clean ? clean.slice(0, max) : null;
};

export const parseAttribution = (raw: unknown): Attribution => {
  if (!raw || typeof raw !== "object") return EMPTY_ATTRIBUTION;
  const r = raw as Record<string, unknown>;
  return {
    utmSource: clip(r.utmSource, 80),
    utmMedium: clip(r.utmMedium, 80),
    utmCampaign: clip(r.utmCampaign, 120),
    utmContent: clip(r.utmContent, 120),
    utmTerm: clip(r.utmTerm, 120),
    fbclid: clip(r.fbclid, 300),
    ttclid: clip(r.ttclid, 300),
    gclid: clip(r.gclid, 300),
    ref: clip(r.ref, 60),
    referrer: clip(r.referrer, 300),
    landingPath: clip(r.landingPath, 200),
  };
};

/** Lee la atribución de una URL (lo usa el navegador al aterrizar). */
export const attributionFromUrl = (search: string, referrer: string | null, path: string | null): Attribution => {
  const q = new URLSearchParams(search);
  return parseAttribution({
    utmSource: q.get("utm_source"),
    utmMedium: q.get("utm_medium"),
    utmCampaign: q.get("utm_campaign"),
    utmContent: q.get("utm_content"),
    utmTerm: q.get("utm_term"),
    fbclid: q.get("fbclid"),
    ttclid: q.get("ttclid"),
    gclid: q.get("gclid"),
    ref: q.get("ref"),
    referrer,
    landingPath: path,
  });
};

/** Si no trae nada que diga de dónde vino. */
export const hasAttribution = (a: Attribution): boolean =>
  Boolean(a.utmSource || a.utmCampaign || a.fbclid || a.ttclid || a.gclid || a.ref);

const hostOf = (url: string | null): string => {
  if (!url) return "";
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
};

export type Channel = "tiktok" | "instagram" | "facebook" | "youtube" | "google" | "whatsapp" | "enlaces" | "sitio" | "otro";

/** El canal, en una palabra, para el CRM: lo que diga la URL, y si no, el referente. */
export const channelOf = (a: Attribution): Channel => {
  const said = `${a.utmSource ?? ""} ${a.ref ?? ""}`.toLowerCase();
  const host = hostOf(a.referrer);
  // Los códigos cortos («ig», «fb») solo como palabra entera: «digital» no es Instagram.
  const tokens = new Set(said.split(/[^a-z0-9]+/).filter(Boolean));
  const has = (...words: string[]) => words.some((w) => (w.length <= 3 ? tokens.has(w) : said.includes(w) || host.includes(w)));
  // Lo que diga la URL manda sobre el clic del anuncio: un reel de Instagram
  // pautado trae `fbclid` y sigue siendo Instagram.
  if (a.ttclid || has("tiktok")) return "tiktok";
  if (has("instagram", "ig")) return "instagram";
  if (has("youtube", "youtu.be", "yt")) return "youtube";
  if (has("whatsapp", "wa.me", "wa")) return "whatsapp";
  if (has("enlaces")) return "enlaces";
  if (a.fbclid || has("facebook", "fb", "meta")) return "facebook";
  if (a.gclid || has("google")) return "google";
  if (host && !host.includes("dayanabeltran")) return "otro";
  return "sitio";
};

export const CHANNEL_LABEL: Record<Channel, string> = {
  tiktok: "TikTok",
  instagram: "Instagram",
  facebook: "Facebook",
  youtube: "YouTube",
  google: "Google",
  whatsapp: "WhatsApp",
  enlaces: "Página de enlaces",
  sitio: "El sitio",
  otro: "Otro sitio",
};

/** El origen del contacto nuevo (el enum del CRM no tiene Facebook ni Google: van como formulario web). */
export const contactSourceFor = (a: Attribution): ContactSource => {
  const channel = channelOf(a);
  // Literales y no el enum: este archivo también lo carga el navegador (sin Prisma).
  if (channel === "tiktok") return "TIKTOK";
  if (channel === "instagram") return "INSTAGRAM";
  if (channel === "youtube") return "YOUTUBE";
  return "WEB_LEAD_FORM";
};

/** «Llamada gratis en la web (Instagram · campaña reel-ansiedad)». */
export const sourceDetailFor = (a: Attribution): string => {
  const parts = [CHANNEL_LABEL[channelOf(a)], a.utmCampaign ? `campaña ${a.utmCampaign}` : null].filter(Boolean);
  return `Llamada gratis en la web (${parts.join(" · ")})`.slice(0, 190);
};

export type StartInput = {
  firstName: string;
  lastName: string | null;
  phone: string;
  phoneCountry: string | null;
  consentMarketing: boolean;
  timezone: string | null;
  attribution: Attribution;
};

export type ParseError = "invalid" | "honeypot" | "name_required" | "phone_required" | "consent_required";

type Parsed<T> = { ok: true; value: T } | { ok: false; error: ParseError };

const isIanaZone = (tz: string): boolean => {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};

export const cleanTimezone = (raw: unknown): string | null => {
  const tz = clip(raw, 64);
  return tz && /^[A-Za-z_]+(\/[A-Za-z0-9_+-]+){1,2}$/.test(tz) && isIanaZone(tz) ? tz : null;
};

/** El formulario del paso 1. `hp` es la trampa para bots: un campo que una persona no ve. */
export const parseStartBody = (raw: unknown): Parsed<StartInput> => {
  if (!raw || typeof raw !== "object") return { ok: false, error: "invalid" };
  const r = raw as Record<string, unknown>;
  if (typeof r.hp === "string" && r.hp.trim()) return { ok: false, error: "honeypot" };
  const firstName = clip(r.firstName, 60);
  // Sin cifras ni «+»: el nombre va al título del evento del calendario, y de
  // ahí el reloj saca el teléfono de la cita (un número ajeno ahí confundiría
  // a quien lo tiene).
  if (!firstName || firstName.length < 2 || /https?:|www\.|[<>@+\d]/i.test(firstName)) return { ok: false, error: "name_required" };
  const lastNameRaw = clip(r.lastName, 60);
  const phone = clip(r.phone, 30);
  if (!phone || phone.replace(/\D/g, "").length < 7) return { ok: false, error: "phone_required" };
  if (r.consentData !== true) return { ok: false, error: "consent_required" };
  const country = clip(r.phoneCountry, 2)?.toUpperCase() ?? null;
  return {
    ok: true,
    value: {
      firstName,
      lastName: lastNameRaw && !/https?:|www\.|[<>@+\d]/i.test(lastNameRaw) ? lastNameRaw : null,
      phone,
      phoneCountry: country && /^[A-Z]{2}$/.test(country) ? country : null,
      consentMarketing: r.consentMarketing === true,
      timezone: cleanTimezone(r.timezone),
      attribution: parseAttribution(r.attribution),
    },
  };
};

// ── Paso 2: preguntas ───────────────────────────────────────────────────────
//
// El modelo de Dayana es híbrido: primero acompaña a la persona a salir de lo
// que la tiene mal (agotamiento, tristeza, ansiedad…) y después a crecer (su
// negocio, su marca personal, su contenido, algo que le dé propósito). Las
// preguntas recogen las dos puntas —cómo está hoy y a dónde quiere llegar— para
// que Dayana llegue a la llamada sabiendo qué ofrecer. Son de elegir: rápidas en
// el celular. Lo personal que se escribe a mano es opcional.

/** Cómo está hoy (lo emocional y lo de crecimiento, en una sola lista). */
export const TOPICS = [
  { id: "agotamiento", label: "Me siento sin energía, con agotamiento" },
  { id: "duelo", label: "Tristeza o algo que no he soltado" },
  { id: "ansiedad", label: "Ansiedad y miedo" },
  { id: "suficiente", label: "No me siento suficiente" },
  { id: "rumbo", label: "No sé para dónde voy" },
  { id: "estancamiento", label: "Siento que mi trabajo no me llena" },
  { id: "otro", label: "Otra cosa" },
] as const;

/** Temas de versiones anteriores del formulario: ya no se ofrecen, pero se siguen leyendo. */
const LEGACY_TOPICS = [
  { id: "pareja", label: "Mi relación de pareja" },
  { id: "dinero", label: "Mi relación con el dinero" },
] as const;

/** A dónde quiere llegar. */
export const GOALS = [
  { id: "paz", label: "Sentirme en paz y con energía otra vez" },
  { id: "negocio", label: "Tener mi propio negocio" },
  { id: "marca", label: "Vivir de mi marca personal y mi contenido" },
  { id: "clientes", label: "Conseguir más clientes en lo que ya hago" },
  { id: "proposito", label: "Encontrar algo que me dé propósito" },
] as const;

export const URGENCIES = [
  { id: "ya", label: "Esta semana" },
  { id: "mes", label: "Este mes" },
  { id: "explorando", label: "Solo estoy explorando" },
] as const;

/**
 * Si la llamada le convence, ¿puede invertir en su proceso? Suave a propósito:
 * es para que Dayana sepa qué proponer, no un filtro que deje a nadie sin
 * llamada.
 */
export const INVESTS = [
  { id: "si", label: "Sí, estoy en disposición" },
  { id: "depende", label: "Depende de lo que me propongan" },
  { id: "no_ahora", label: "Por ahora no puedo" },
] as const;

export type TopicId = (typeof TOPICS)[number]["id"] | (typeof LEGACY_TOPICS)[number]["id"];
export type GoalId = (typeof GOALS)[number]["id"];
export type UrgencyId = (typeof URGENCIES)[number]["id"];
export type InvestId = (typeof INVESTS)[number]["id"];

export type Answers = {
  topic: TopicId;
  urgency: UrgencyId;
  /** Desde que existe la pregunta; las filas anteriores no lo tienen. */
  goal: GoalId | null;
  invest: InvestId | null;
  /** A qué se dedica hoy (opcional). */
  occupation: string | null;
  /** Su Instagram o TikTok (opcional). */
  social: string | null;
  note: string | null;
};

export type AnswersInput = Answers & { email: string | null };

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const ALL_TOPICS = [...TOPICS, ...LEGACY_TOPICS];

/** Una cuenta de redes: @usuario o un enlace de Instagram / TikTok; nada más. */
export const cleanSocial = (raw: unknown): string | null => {
  const v = clip(raw, 120);
  if (!v) return null;
  const url = v.match(/^(?:https?:\/\/)?(?:www\.)?(instagram\.com|tiktok\.com)\/@?([A-Za-z0-9._]{1,40})/i);
  if (url) return `@${url[2]} (${url[1].toLowerCase().startsWith("tiktok") ? "TikTok" : "Instagram"})`;
  const handle = v.replace(/^@/, "");
  return /^[A-Za-z0-9._]{1,40}$/.test(handle) ? `@${handle}` : null;
};

export const parseAnswersBody = (raw: unknown): Parsed<AnswersInput> => {
  if (!raw || typeof raw !== "object") return { ok: false, error: "invalid" };
  const r = raw as Record<string, unknown>;
  const topic = ALL_TOPICS.find((t) => t.id === r.topic)?.id;
  const urgency = URGENCIES.find((u) => u.id === r.urgency)?.id;
  if (!topic || !urgency) return { ok: false, error: "invalid" };
  const email = clip(r.email, 160)?.toLowerCase() ?? null;
  return {
    ok: true,
    value: {
      topic,
      urgency,
      goal: GOALS.find((g) => g.id === r.goal)?.id ?? null,
      invest: INVESTS.find((i) => i.id === r.invest)?.id ?? null,
      occupation: clip(r.occupation, 120),
      social: cleanSocial(r.social),
      note: clip(r.note, 500),
      email: email && EMAIL.test(email) ? email : null,
    },
  };
};

/** Lo guardado en `answers`, leído con cuidado (es JSON de la base). */
export const readAnswers = (raw: unknown): Answers | null => {
  const parsed = parseAnswersBody(raw);
  if (!parsed.ok) return null;
  const { email: _email, ...answers } = parsed.value;
  void _email;
  return answers;
};

export const topicLabel = (id: string | null | undefined): string | null => ALL_TOPICS.find((t) => t.id === id)?.label ?? null;
export const goalLabel = (id: string | null | undefined): string | null => GOALS.find((g) => g.id === id)?.label ?? null;
export const urgencyLabel = (id: string | null | undefined): string | null => URGENCIES.find((u) => u.id === id)?.label ?? null;
export const investLabel = (id: string | null | undefined): string | null => INVESTS.find((i) => i.id === id)?.label ?? null;

/** La línea para las notas del contacto: Dayana la lee antes de llamar. */
export const answersNote = (answers: Answers, stamp: string): string =>
  [
    `[${stamp}] Pidió su llamada gratis en la página.`,
    `Hoy: ${topicLabel(answers.topic)}.`,
    answers.goal ? `Quiere llegar a: ${goalLabel(answers.goal)}.` : null,
    `Para cuándo: ${urgencyLabel(answers.urgency)}.`,
    answers.invest ? `¿Invertir en su proceso?: ${investLabel(answers.invest)}.` : null,
    answers.occupation ? `Se dedica a: ${answers.occupation}.` : null,
    answers.social ? `Redes: ${answers.social}.` : null,
    answers.note ? `Contó: «${answers.note}»` : null,
  ]
    .filter(Boolean)
    .join(" ");

// ── Paso 3: horas ───────────────────────────────────────────────────────────

export type FunnelSlot = { startIso: string; endIso: string; dateKey: string };

/**
 * Las horas que se muestran: los primeros `days` días que tengan cupo, y de
 * cada uno hasta `perDay` horas repartidas en el día (no las seis primeras de
 * la mañana). `fullDays`: días que ya tienen el tope de llamadas gratis.
 */
export const pickFunnelSlots = <T extends FunnelSlot>(
  slots: T[],
  opts: { days: number; perDay: number; fullDays?: Set<string> }
): T[] => {
  const byDay = new Map<string, T[]>();
  for (const s of [...slots].sort((a, b) => a.startIso.localeCompare(b.startIso))) {
    if (opts.fullDays?.has(s.dateKey)) continue;
    const list = byDay.get(s.dateKey) ?? [];
    list.push(s);
    byDay.set(s.dateKey, list);
  }
  const out: T[] = [];
  for (const [, list] of [...byDay].slice(0, Math.max(1, opts.days))) out.push(...spread(list, opts.perDay));
  return out;
};

/** `count` elementos repartidos a lo largo de la lista, siempre con el primero y el último. */
const spread = <T>(list: T[], count: number): T[] => {
  if (list.length <= count) return list;
  if (count <= 1) return list.slice(0, 1);
  const picked = new Set<number>();
  for (let i = 0; i < count; i++) picked.add(Math.round((i * (list.length - 1)) / (count - 1)));
  return [...picked].sort((a, b) => a - b).map((i) => list[i]);
};

/** La hora pedida tiene que ser una de las que se le mostrarían ahora mismo. */
export const isOfferedSlot = (startIso: string, offered: FunnelSlot[]): boolean => {
  const at = Date.parse(startIso);
  return Number.isFinite(at) && offered.some((s) => Date.parse(s.startIso) === at);
};

// ── Su página ───────────────────────────────────────────────────────────────

/** En qué va la persona. */
export type LeadStage =
  /** Dejó nombre y WhatsApp. */
  | "datos"
  /** Respondió las preguntas, no eligió hora. */
  | "preguntas"
  /** Tiene su llamada por delante. */
  | "agendada"
  /** La llamada ya pasó y hablaron. */
  | "hablaron"
  /** La llamada ya pasó y no contestó. */
  | "no_contesto"
  /** La llamada ya pasó y todavía no se sabe cómo terminó. */
  | "pasada"
  /** Canceló (o la reserva ya no existe). */
  | "cancelada";

export const STAGE_LABEL: Record<LeadStage, string> = {
  datos: "Dejó sus datos",
  preguntas: "Respondió, sin hora",
  agendada: "Llamada agendada",
  hablaron: "Hablaron",
  no_contesto: "No contestó",
  pasada: "Llamada por confirmar",
  cancelada: "Canceló",
};

export const stageOf = (input: {
  answeredAt: Date | null;
  cancelledAt: Date | null;
  booking: { startsAt: Date; endsAt: Date; status: string } | null;
  /** `calendar_appointments.call_outcome` de esa cita. */
  callOutcome: string | null;
  now: Date;
}): LeadStage => {
  const b = input.booking;
  const live = b && !["CANCELLED", "cancelled"].includes(b.status);
  if (live) {
    if (b.endsAt.getTime() > input.now.getTime()) return "agendada";
    if (input.callOutcome === "answered") return "hablaron";
    if (input.callOutcome === "no_answer") return "no_contesto";
    return "pasada";
  }
  if (input.cancelledAt || b) return "cancelada";
  return input.answeredAt ? "preguntas" : "datos";
};

/** Sin llamada por delante ni pasada: a quien Dayana (o la asistente) puede escribirle para que agende. */
export const needsFollowUp = (stage: LeadStage): boolean => stage === "datos" || stage === "preguntas" || stage === "cancelada";

const fmt = (iso: string, timeZone: string, options: Intl.DateTimeFormatOptions): string =>
  new Intl.DateTimeFormat("es-CO", { timeZone, ...options }).format(new Date(iso));

/** «jueves 12 de noviembre». */
export const dayLabel = (iso: string, timeZone: string): string => fmt(iso, timeZone, { weekday: "long", day: "numeric", month: "long" });

/** «4:15 p. m.». */
export const timeLabel = (iso: string, timeZone: string): string => fmt(iso, timeZone, { hour: "numeric", minute: "2-digit", hour12: true });

/** «jueves 12 de noviembre, 4:15 p. m.». */
export const whenLabel = (iso: string, timeZone: string): string => `${dayLabel(iso, timeZone)}, ${timeLabel(iso, timeZone)}`;

/** El mensaje que la persona le manda a Dayana para confirmar (abre la ventana de 24 h de WhatsApp). */
export const confirmMessage = (firstName: string, startIso: string, personTz: string, dayanaTz?: string): string => {
  // Si su zona no es la de Dayana, también la hora de Colombia: quien lee el mensaje es Dayana.
  const theirs = whenLabel(startIso, personTz);
  const hers = dayanaTz && dayanaTz !== personTz ? whenLabel(startIso, dayanaTz) : null;
  return `Hola, soy ${firstName}. Agendé mi llamada gratis con Dayana para el ${theirs}${hers && hers !== theirs ? ` (${hers}, hora de Colombia)` : ""}. Confirmo que ahí estaré.`;
};

/**
 * El mensaje de «¿Necesitas ayuda?». Sin llamada: dejó sus datos y no pudo
 * elegir hora. Con llamada (la tiene o ya pasó): decir «quiero elegir una
 * hora» sería falso.
 */
export const helpMessage = (firstName: string, hasCall = false): string =>
  hasCall
    ? `Hola, soy ${firstName}. Te escribo por mi llamada gratis con Dayana.`
    : `Hola, soy ${firstName}. Dejé mis datos en la página para agendar mi llamada gratis con Dayana y quiero elegir una hora.`;

const icsStamp = (d: Date): string => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

const icsText = (s: string): string => s.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/([,;])/g, "\\$1");

/** El archivo .ics de la cita (Apple Calendar, Outlook). Con aviso 30 minutos antes. */
export const buildIcs = (input: { uid: string; startIso: string; endIso: string; now: Date; url: string }): string =>
  [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Dayana Beltran PNL//Llamada gratis//ES",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${input.uid}@dayanabeltran.com`,
    `DTSTAMP:${icsStamp(input.now)}`,
    `DTSTART:${icsStamp(new Date(input.startIso))}`,
    `DTEND:${icsStamp(new Date(input.endIso))}`,
    `SUMMARY:${icsText("Llamada gratis con Dayana Beltrán")}`,
    `DESCRIPTION:${icsText(`Dayana te llama por WhatsApp a esta hora. Ten a mano un espacio tranquilo.\nCambiar o cancelar: ${input.url}`)}`,
    `URL:${input.url}`,
    "BEGIN:VALARM",
    "TRIGGER:-PT30M",
    "ACTION:DISPLAY",
    "DESCRIPTION:Tu llamada con Dayana es en 30 minutos",
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
    "",
  ].join("\r\n");

/** El enlace «Añadir a Google Calendar». */
export const googleCalendarUrl = (input: { startIso: string; endIso: string; url: string }): string => {
  const q = new URLSearchParams({
    action: "TEMPLATE",
    text: "Llamada gratis con Dayana Beltrán",
    dates: `${icsStamp(new Date(input.startIso))}/${icsStamp(new Date(input.endIso))}`,
    details: `Dayana te llama por WhatsApp a esta hora. Ten a mano un espacio tranquilo.\nCambiar o cancelar: ${input.url}`,
  });
  return `https://calendar.google.com/calendar/render?${q.toString()}`;
};

// ── Ajustes ─────────────────────────────────────────────────────────────────

export type CallFunnelConfig = {
  /** La página pública abierta. Cerrada, `/llamada` manda a WhatsApp. */
  enabled: boolean;
  /** Cuántos días con cupo se muestran (pocos: entre más lejos, menos gente llega). */
  days: number;
  /** Cuántas horas por día. */
  perDay: number;
  /** Cuántas llamadas puede agendar una misma conexión en 24 h (contra el abuso). */
  bookingsPerIpPerDay: number;
};

export const DEFAULT_FUNNEL_CONFIG: CallFunnelConfig = { enabled: true, days: 3, perDay: 6, bookingsPerIpPerDay: 2 };

const int = (raw: unknown, min: number, max: number, fallback: number): number => {
  const n = typeof raw === "number" ? raw : typeof raw === "string" && raw.trim() ? Number(raw) : NaN;
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback;
};

/** Cada clave por separado: un valor malo no borra los demás. */
export const parseFunnelConfig = (raw: unknown): CallFunnelConfig => {
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const d = DEFAULT_FUNNEL_CONFIG;
  return {
    enabled: typeof r.enabled === "boolean" ? r.enabled : d.enabled,
    days: int(r.days, 1, 7, d.days),
    perDay: int(r.perDay, 2, 12, d.perDay),
    bookingsPerIpPerDay: int(r.bookingsPerIpPerDay, 1, 10, d.bookingsPerIpPerDay),
  };
};
