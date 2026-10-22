import { getDateKeyInTz, getTimeLabelInTz } from "@/lib/datetime/zoned-time";

import { foldForSearch } from "../search-normalize";
import { dualZoneLabel } from "./free-call-rules";
import { timesIn, weekdaysIn } from "./promise-guard";

/**
 * Qué hora eligió la persona de la última lista de horas, en código (pedido del
 * dueño, 21-oct: «un agente de agendamiento sin errores»). Natalia escribió «Ya
 * hoy a las 12:45 pm», la IA volvió a ofrecer, agendar falló y aun así le
 * confirmó la cita; el modelo escribía el `startIso` a mano y las horas en
 * texto libre. Ahora la lista la pega el código (numerada) y una respuesta que
 * señala UNA opción sin dudas («2», «la primera», «el viernes a las 3», «hoy a
 * las 12:45») se agenda sin pasar por el modelo. Ante la duda, nada: sigue el
 * modelo, como antes.
 */

export type OfferedSlot = { startIso: string; label: string };

export type ChoiceContext = { personTz: string; dayanaTz: string; now: Date };

export type Choice = { kind: "one"; option: OfferedSlot } | { kind: "many"; options: OfferedSlot[] } | { kind: "none" };

/**
 * Lo que no es elegir: una pregunta, un «no puedo», otra hora u otro día, lo
 * que tiene que hacer («tengo cita médica a las 3»), un «pero».
 */
const NOT_A_CHOICE =
  /[?¿]|\b(no|ninguna|ninguno|otra|otro|otras|otros|cambiar|cambio|tampoco|tengo|trabajo|estoy|ocupad[oa]s?|cita|clase|reunion|imposible|dificil|complicad[oa]|pero|aunque|cuanto|cuesta|precio)\b/;
/** Una respuesta de verdad corta: lo largo trae más cosas que contestar. */
const MAX_CHOICE_CHARS = 80;

const ORDINAL: Record<string, number> = {
  primera: 1,
  primer: 1,
  primero: 1,
  "1ra": 1,
  "1era": 1,
  segunda: 2,
  segundo: 2,
  "2da": 2,
  tercera: 3,
  tercer: 3,
  tercero: 3,
  "3ra": 3,
  "3era": 3,
  cuarta: 4,
  "4ta": 4,
};
const ORDINAL_WORD = new RegExp(`\\b(${[...Object.keys(ORDINAL), "ultima", "ultimo"].join("|")})\\b`, "g");

/** Palabras que acompañan un «2» sin cambiarlo («sí, la 2 por favor», «me queda mejor la 2»). */
const FILLER = new Set(
  "si ok okey okay vale perfecto listo dale bueno la el opcion numero num nro por favor porfa gracias me te queda sirve mejor esa ese esta este de que quiero prefiero elijo escojo y bien genial excelente super ya entonces pues hola claro seria sera va".split(
    " "
  )
);

const MONTHS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const DAY_OF_MONTH = new RegExp(`\\b(\\d{1,2})\\s+de\\s+(${MONTHS.join("|")})\\b`, "g");
const WEEKDAY_AND_DAY = /\b(lunes|martes|miercoles|jueves|viernes|sabado|domingo)\s+(\d{1,2})\b(?!\s*(?::|[ap]\.?\s?m\b|de la\b|h\b))/g;
/** «la 2», «opción 1», «#3», no «las 2» ni «el 2 de noviembre». */
const NUMBER_REF = new RegExp(
  `(?:\\b(?:la|el|opcion|numero|nro)\\s*|#\\s*)([1-9])\\b(?!\\s*(?::|[ap]\\.?\\s?m\\b|de la\\b|h\\b|de\\s+(?:${MONTHS.join("|")})))`
);
/** «12:45» sin a. m./p. m. ni «a las». */
const CLOCK = /\b(\d{1,2}):([0-5]\d)\b/g;

const timeKey = (iso: string, tz: string) => {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit", hour12: true }).formatToParts(new Date(iso));
  const hour = parts.find((p) => p.type === "hour")?.value ?? "";
  const minute = parts.find((p) => p.type === "minute")?.value ?? "";
  const ap = (parts.find((p) => p.type === "dayPeriod")?.value ?? "").toLowerCase().startsWith("p") ? "p" : "a";
  return `${Number(hour)}:${minute}${ap}`;
};
const weekdayOf = (iso: string, tz: string) =>
  foldForSearch(new Intl.DateTimeFormat("es-CO", { timeZone: tz, weekday: "long" }).format(new Date(iso)));
const dayOfMonth = (iso: string, tz: string) => Number(new Intl.DateTimeFormat("en-US", { timeZone: tz, day: "numeric" }).format(new Date(iso)));
const monthOf = (iso: string, tz: string) => Number(new Intl.DateTimeFormat("en-US", { timeZone: tz, month: "numeric" }).format(new Date(iso)));

type Filters = {
  times: string[];
  weekdays: string[];
  /** Días relativos: 0 hoy, 1 mañana, 2 pasado mañana. */
  relative: number[];
  /** Día del mes, con el mes si lo dijo. */
  days: { day: number; month: number | null }[];
};

const filtersOf = (folded: string): Filters => {
  const times = new Set(timesIn(folded));
  for (const m of folded.matchAll(CLOCK)) {
    const hour = Number(m[1]);
    const key = `${hour}:${m[2]}`;
    if (hour >= 1 && hour <= 12 && !times.has(`${key}a`) && !times.has(`${key}p`)) times.add(key);
  }
  const relative: number[] = [];
  if (/\bhoy\b/.test(folded)) relative.push(0);
  if (/\bpasado manana\b/.test(folded)) relative.push(2);
  // «mañana» el día, no «de la mañana» / «en la mañana» / «por la mañana».
  else if (/(?<!\b(?:la|de la|en la|por la|pasado)\s)\bmanana\b/.test(folded)) relative.push(1);
  const days: Filters["days"] = [];
  for (const m of folded.matchAll(DAY_OF_MONTH)) days.push({ day: Number(m[1]), month: MONTHS.indexOf(m[2]) + 1 });
  for (const m of folded.matchAll(WEEKDAY_AND_DAY)) days.push({ day: Number(m[2]), month: null });
  return { times: [...times], weekdays: weekdaysIn(folded), relative, days };
};

const hasFilters = (f: Filters) => f.times.length + f.weekdays.length + f.relative.length + f.days.length > 0;

/** ¿La opción cumple todo lo que dijo, leído en una sola zona (la suya o la de Colombia)? */
const matches = (option: OfferedSlot, f: Filters, ctx: ChoiceContext): boolean =>
  [ctx.personTz, ctx.dayanaTz].some((tz) => {
    const iso = option.startIso;
    if (f.times.length) {
      const key = timeKey(iso, tz);
      if (!f.times.some((t) => t === key || (!/[ap]$/.test(t) && key.slice(0, -1) === t))) return false;
    }
    if (f.weekdays.length && !f.weekdays.includes(weekdayOf(iso, tz))) return false;
    if (f.relative.length) {
      const today = getDateKeyInTz(ctx.now, tz);
      const day = getDateKeyInTz(new Date(iso), tz);
      const wanted = f.relative.map((n) => getDateKeyInTz(new Date(ctx.now.getTime() + n * 24 * 3600_000), tz));
      if (!wanted.includes(day) && !(f.relative.includes(0) && day === today)) return false;
    }
    if (f.days.length && !f.days.some((d) => d.day === dayOfMonth(iso, tz) && (d.month === null || d.month === monthOf(iso, tz)))) return false;
    return true;
  });

/** El número de opción que señaló («2», «la 2», «la segunda», «la última»), 1-based, o null. */
const pickedNumber = (folded: string, count: number): number | null => {
  const words = folded
    .replace(/[^\p{L}\p{N}#\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
  const rest = words.filter((w) => !FILLER.has(w));
  if (rest.length === 1 && /^[1-9]$/.test(rest[0])) return Number(rest[0]);
  const ref = folded.match(NUMBER_REF);
  if (ref) return Number(ref[1]);
  const ordinals = [...folded.matchAll(ORDINAL_WORD)].map((m) => m[1]);
  if (ordinals.length === 1) return ordinals[0].startsWith("ultim") ? count : ORDINAL[ordinals[0]];
  return null;
};

export const resolveChoice = (text: string, options: OfferedSlot[], ctx: ChoiceContext): Choice => {
  const folded = foldForSearch(text).replace(/\s+/g, " ").trim();
  if (!options.length || !folded || folded.length > MAX_CHOICE_CHARS || NOT_A_CHOICE.test(folded)) return { kind: "none" };
  const filters = filtersOf(folded);
  const n = pickedNumber(folded, options.length);
  if (n !== null) {
    const option = options[n - 1];
    if (!option) return { kind: "none" };
    // «la 1 a las 9» y la 1 no es a las 9: no se adivina cuál quiso.
    if (hasFilters(filters) && !matches(option, filters, ctx)) return { kind: "none" };
    return { kind: "one", option };
  }
  if (!hasFilters(filters)) return { kind: "none" };
  const found = options.filter((o) => matches(o, filters, ctx));
  if (found.length === 1) return { kind: "one", option: found[0] };
  return found.length > 1 ? { kind: "many", options: found } : { kind: "none" };
};

type ChatLine = {
  direction: string;
  body?: string | null;
  sentAt: Date;
  kind?: string | null;
  status?: string | null;
  attachments?: unknown;
};

/** Hasta cuántos mensajes seguidos de la persona se leen como una respuesta a la lista. */
const MAX_BURST = 3;

/**
 * ¿Lo que escribió la persona contesta la lista de horas? Solo si lo último que
 * recibió antes de sus mensajes ES esa lista (salió después de guardarla y trae
 * sus horas), sin fotos ni archivos (un comprobante no es elegir) y en pocos
 * mensajes. Si la conversación siguió por otro lado, no: «el jueves» puede ser
 * otra cosa. Mensajes del más nuevo al más viejo; devuelve lo que escribió.
 */
export const replyToOffer = (messagesNewestFirst: ChatLine[], offer: { at: Date; options: OfferedSlot[] }): string | null => {
  const lines = messagesNewestFirst.filter((m) => m.kind !== "system" && m.status !== "FAILED");
  let i = 0;
  while (i < lines.length && lines[i].direction === "INBOUND") i++;
  const burst = lines.slice(0, i);
  const before = lines[i];
  if (!burst.length || burst.length > MAX_BURST || !before || before.direction !== "OUTBOUND") return null;
  if (burst.some((m) => Array.isArray(m.attachments) && m.attachments.length > 0)) return null;
  if (before.sentAt.getTime() < offer.at.getTime()) return null;
  // Es la lista: trae TODAS sus horas y pregunta. La confirmación trae una sola
  // hora (la agendada) y no pregunta: «la 2» después no movía la llamada recién
  // agendada por poco (e2e, 21-oct).
  const body = before.body ?? "";
  if (!offer.options.every((o) => body.includes(o.label)) || !body.includes("?")) return null;
  const text = burst
    .map((m) => (m.body ?? "").trim())
    .filter(Boolean)
    .reverse()
    .join(" ");
  return text || null;
};

export const CHOICE_QUESTION = "¿Cuál te queda mejor? Puedes responderme con el número.";

const OFFER_LEAD = "Estas son las horas libres de Dayana para tu llamada gratis de 15 minutos:";
const OFFER_LEAD_CLOSEST = "En lo que me dijiste no hay espacio en la agenda de Dayana, pero estas horas sí están libres:";

/**
 * El mensaje con horas: la frase del modelo (sin horas ni pregunta) y debajo
 * la lista del código. Sin frase, una fija.
 */
export const offerMessage = (modelText: string, options: OfferedSlot[], matchedWish: boolean | null): string => {
  const lead = withoutSlotLines(modelText) || (matchedWish === false ? OFFER_LEAD_CLOSEST : OFFER_LEAD);
  return `${lead}\n\n${offerList(options)}`;
};

/**
 * La confirmación sale del código con la hora de la reserva de verdad (lo que
 * devolvió agendar), nunca del modelo: a Natalia le confirmó una hora que no se
 * agendó, a Alexandra otro día.
 */
export const bookedMessage = (kind: "booked" | "moved", label: string, first: string | null): string => {
  const hi = first ? `Listo, ${first}.` : "Listo.";
  // «12:45 p. m.» ya trae el punto.
  const when = /\.$/.test(label) ? label : `${label}.`;
  const what = kind === "moved" ? `Tu llamada gratis con Dayana pasó al ${when}` : `Tu llamada gratis con Dayana quedó para el ${when}`;
  return `${hi} ${what} Dayana te llama por WhatsApp a este número.`;
};

/**
 * El día y la hora de sus citas, para el freno de promesas: en cada zona
 * («viernes 3:00 a. m.») y además con las dos horas juntas, como las escribe la
 * confirmación. Así, pasada la medianoche, «viernes… 3:00 a. m. (tu hora) ·
 * 9:00 p. m. en Colombia» se reconoce (el freno sabe que esa hora de Colombia
 * es del día de al lado); con las zonas sueltas la confirmación no salía.
 */
export const bookedLabelsFor = (dates: Date[], zones: string[], dayanaTz: string): string[] =>
  dates
    .filter((d) => !Number.isNaN(d.getTime()))
    .flatMap((d) => [
      ...zones.map((z) => `${new Intl.DateTimeFormat("es-CO", { timeZone: z, weekday: "long" }).format(d)} ${getTimeLabelInTz(d, z)}`),
      ...zones.filter((z) => z !== dayanaTz).map((z) => dualZoneLabel(d.toISOString(), z, dayanaTz)),
    ]);

/** Varias opciones cuadran con lo que dijo («el viernes»): se pregunta solo entre esas. */
export const narrowMessage = (options: OfferedSlot[]): string => `¿Cuál de estas?\n\n${offerList(options)}`;

/** Eligió la hora que ya tiene: sigue en pie. */
export const alreadyMessage = (label: string): string =>
  `Tu llamada gratis con Dayana ya está agendada para el ${/\.$/.test(label) ? label : `${label}.`} Dayana te llama por WhatsApp a este número.`;

/** La hora que eligió ya no está libre: estas sí. */
export const takenMessage = (options: OfferedSlot[]): string =>
  `Esa hora ya no está libre en la agenda de Dayana. Estas sí:\n\n${offerList(options)}`;

/** La lista que pega el código debajo del mensaje: numerada, en el orden en que se guardó. */
export const offerList = (options: OfferedSlot[]): string =>
  `${options.map((o, i) => `${i + 1}. ${o.label}`).join("\n")}\n\n${CHOICE_QUESTION}`;

/**
 * Del texto del modelo, lo que no sea la lista: sin horas, sin fechas ni la
 * pregunta (las pone el código). No parte en «p. m.»: una frase que termina en
 * una hora se va entera.
 */
const SENTENCE_END = /(?<=[.!?])(?<!\b[ap]\.)(?<!\b[ap]\.\s?m\.)\s+/;
const BULLET = /^\s*(?:[•\-*]|\d+[.)])\s+/;
export const withoutSlotLines = (text: string): string =>
  text
    .split("\n")
    .map((line) =>
      BULLET.test(line)
        ? ""
        : line
            .split(SENTENCE_END)
            .filter((s) => {
              const f = foldForSearch(s);
              return !/[?¿]/.test(s) && timesIn(f).length === 0 && !f.match(DAY_OF_MONTH) && !/\b\d{1,2}:[0-5]\d\b/.test(f);
            })
            .join(" ")
            .trim()
    )
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
