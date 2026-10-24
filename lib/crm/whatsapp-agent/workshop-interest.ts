import { foldForSearch } from "../search-normalize";

/**
 * Quien pregunta por el taller abierto (dueña, 24-oct). Dayana anunció «Tu
 * Sanación con el Dinero» (15 de noviembre) y en quince minutos cinco personas
 * preguntaron el costo: a dos la asistente les dijo que no había ningún taller
 * (aún no estaba en el CRM) y a Naty, que ya había tenido su llamada, le
 * reenvió el enlace de su proceso. Dueña: «el modelo puede enviar la info y
 * separar la llamada… para inscribirse toca con llamada a Dayana».
 *
 * Así que a quien pregunta por el taller abierto: que sí está abierto, cuándo
 * es y de qué trata, y la llamada con Dayana para inscribirse (sin el valor ni
 * enlaces de pago: se los da Dayana). Vale también para quien ya tuvo su
 * llamada gratis o solo se inscribió al webinar. Y Dayana ve la lista de
 * interesadas en el taller (`workshop-interests.ts`).
 *
 * Puro: lo usan `brain.ts`, `run.ts`, el CRM y las pruebas.
 */

export type OpenWorkshop = {
  id: string;
  title: string;
  slug: string;
  startsAt: Date | null;
  /** false = solo el día (la hora de `startsAt` es un ancla). */
  startsAtHasTime: boolean;
  timezone: string;
  dateLabel: string | null;
  scheduleLabel: string | null;
  cardSummary: string | null;
};

const MONTHS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const STOP = new Set(["de", "del", "la", "el", "los", "las", "con", "tu", "tus", "y", "en", "para", "por", "un", "una", "mi", "su", "sus"]);

/** Las palabras que distinguen el título («sanacion», «dinero»). */
export const titleWords = (title: string): string[] =>
  foldForSearch(title)
    .split(/[^a-z0-9ñ]+/)
    .filter((w) => w.length >= 4 && !STOP.has(w));

/** El día y el mes del taller en su zona («15», «noviembre»). */
const dayMonth = (w: OpenWorkshop): { day: string; month: string } | null => {
  if (!w.startsAt) return null;
  const parts = new Intl.DateTimeFormat("es-CO", { timeZone: w.timezone, day: "numeric", month: "numeric" }).formatToParts(w.startsAt);
  const day = parts.find((p) => p.type === "day")?.value;
  const month = Number(parts.find((p) => p.type === "month")?.value);
  return day && month ? { day, month: MONTHS[month - 1] } : null;
};

const INTEREST =
  /\?|\b(costo|costos|precio|precios|valor|cuanto|cuesta|vale|info|informacion|inscrib\w*|apunt\w*|cupo|cupos|interes\w*|quiero|quisiera|me gustaria|link|enlace|horario|horarios|hora|fecha|cuando|donde|participar|asistir|separar|reservar|unirme|entrar)\b/;

/**
 * ¿Pregunta por el taller abierto? «taller» y una señal de interés («¿cuánto
 * cuesta?», «me interesa inscribirme», «info») o algo de esta edición (el día,
 * el mes, una palabra del título). No «son del taller de jabones» (otro
 * taller) ni «trato de hacer los talleres» (una clienta del curso).
 */
export const isWorkshopAsk = (text: string | null | undefined, w: OpenWorkshop): boolean => {
  const t = foldForSearch(text ?? "");
  if (!/\b(taller|talleres|workshop)\b/.test(t)) return false;
  const words = titleWords(w.title);
  const dm = dayMonth(w);
  // «taller de X» con una X que no es de este taller: es otro.
  const of = /\btaller(?:es)? de (?:la |el |los |las )?([a-z0-9ñ]+)/.exec(t);
  if (of && !words.includes(of[1]) && !MONTHS.includes(of[1]) && !/^\d/.test(of[1]) && !["dayana", "pnl"].includes(of[1])) return false;
  const specific = words.some((x) => t.includes(x)) || Boolean(dm && new RegExp(`\\b${dm.day}\\b[^.?!]{0,8}\\b${dm.month}\\b`).test(t));
  return specific || INTEREST.test(t);
};

type Line = { direction: string; body: string | null; sentAt?: Date | null };

/**
 * Preguntó por el taller en las últimas 24 h (el país, la hora elegida y el
 * «sí» vienen después). También lo último que escribió, junto: Naty mandó «Mi
 * pregunta es, para el 15 de noviembre» y «El taller» en dos mensajes.
 */
export const workshopAskedRecently = (lines: Line[], w: OpenWorkshop, now = Date.now()): boolean => {
  const recent = (l: Line) => !l.sentAt || l.sentAt.getTime() >= now - 24 * 3600_000;
  if (lines.some((l) => l.direction === "INBOUND" && recent(l) && isWorkshopAsk(l.body, w))) return true;
  const tail: string[] = [];
  for (const l of [...lines].reverse()) {
    if (l.direction !== "INBOUND") break;
    if (recent(l) && l.body) tail.unshift(l.body);
  }
  return tail.length > 1 && isWorkshopAsk(tail.join("\n"), w);
};

/** «8:30 a.m. – 4:30 p.m. · virtual» → «8:30 a. m. – 4:30 p. m., virtual». */
const tidySchedule = (s: string) =>
  s
    .replace(/\b([ap])\.?\s?m\.?/gi, (_, x: string) => `${x.toLowerCase()}. m.`)
    .replace(/\s*·\s*/g, ", ")
    .trim();

/** «el taller «Tu Sanación con el Dinero» es el domingo 15 de noviembre, 8:30 a. m. – 4:30 p. m., virtual (hora de Colombia)». */
export const workshopFacts = (w: OpenWorkshop): string => {
  const date = w.startsAt
    ? new Intl.DateTimeFormat("es-CO", { timeZone: w.timezone, weekday: "long", day: "numeric", month: "long" }).format(w.startsAt).replace(",", "")
    : (w.dateLabel ?? "").trim();
  const when = [date, w.scheduleLabel ? tidySchedule(w.scheduleLabel) : null].filter(Boolean).join(", ");
  return `el taller «${w.title}»${when ? ` es el ${when} (hora de Colombia)` : ""}`;
};

/** La línea del prompt cuando pregunta por el taller (solo entonces: el prompt fijo no cambia). */
export const workshopLine = (w: OpenWorkshop, opts: { upcomingLabel: string | null }): string =>
  [
    `PREGUNTA POR EL TALLER: ${workshopFacts(w)}. ${w.cardSummary ? `De qué trata: ${w.cardSummary.trim()} ` : ""}En 2 o 3 frases cortas: dile que sí está abierto, cuándo es y, en pocas palabras, de qué trata.`,
    opts.upcomingLabel
      ? `Ya tiene su llamada con Dayana (${opts.upcomingLabel}): dile que en esa llamada Dayana le explica todo y la inscribe. No le ofrezcas otra.`
      : "La inscripción es con una llamada con Dayana (también si ya tuvo su llamada gratis o solo se inscribió al webinar): ofrécele separarla y, cuando diga que sí, sigue el agendamiento de siempre (si no sabes desde qué país escribe, pregúntalo primero; luego offer_free_call_slots y book_free_call).",
    "No le des el valor ni enlaces de pago: se los da Dayana en la llamada. Es otra cosa distinta a su proceso: no le mandes el enlace ni los datos de su proceso.",
  ].join(" ");

/** La respuesta del código si el modelo dice que no hay taller o se lo pasa a Dayana. */
export const workshopReply = (w: OpenWorkshop, opts: { upcomingLabel: string | null }): string => {
  const facts = workshopFacts(w);
  const open = `Sí, ${facts.replace(/^el taller («[^»]+»)( es )?/, (_, title: string, es?: string) => `el taller ${title} está abierto${es ? ": es " : ""}`)}.`;
  return opts.upcomingLabel
    ? `${open} En tu llamada con Dayana (${opts.upcomingLabel}) ella te explica todo y te inscribe.`
    : `${open} La inscripción es con una llamada con Dayana, donde te explica todo. ¿Quieres que te la separe?`;
};

/**
 * Lo que la dueña pidió decir siempre (24-oct: «que sí está abierto y que para
 * inscribirse toca con llamada a Dayana»). La evaluación mostró que el modelo
 * da la información y pregunta el país, pero se salta las dos cosas: si falta
 * alguna, va antes de la pregunta del final (o al final). Con la llamada ya
 * agendada: que en esa llamada Dayana la inscribe.
 */
export const withWorkshopCall = (text: string, opts: { upcomingLabel: string | null }): string => {
  const t = foldForSearch(text);
  const saysOpen = /\babiert[oa]s?\b/.test(t);
  const saysCall = /\bllamada\b/.test(t);
  if (saysOpen && saysCall) return text;
  const call = opts.upcomingLabel
    ? `En tu llamada con Dayana (${opts.upcomingLabel}) ella te explica todo y te inscribe.`
    : null;
  const add = call
    ? `${saysOpen ? "" : "Las inscripciones están abiertas. "}${saysCall ? "" : call}`.trim()
    : saysOpen
      ? "La inscripción es con una llamada con Dayana, donde te explica todo."
      : saysCall
        ? "Las inscripciones están abiertas."
        : "Las inscripciones están abiertas y son con una llamada con Dayana, donde te explica todo.";
  const body = text.trim();
  // Antes de la pregunta del final («¿Desde qué país me escribes?»).
  const q = body.lastIndexOf("¿");
  if (q > 0 && body.endsWith("?") && !body.slice(q).includes("\n")) {
    const before = body.slice(0, q).trimEnd();
    const sep = /[.!?:]$/.test(before) ? " " : ". ";
    return `${before}${sep}${add} ${body.slice(q)}`;
  }
  const sep = /[.!?]$/.test(body) ? " " : ". ";
  return `${body}${sep}${add}${call || saysCall ? "" : " ¿Quieres que te la separe?"}`;
};

/** «No hay ningún taller programado» cuando sí lo hay (Noralma y Naty, 24-oct). */
export const saysNoWorkshop = (text: string | null | undefined): boolean =>
  /\b(no (hay|tenemos|tiene)( (ningun|algun))? taller|ningun taller|no hay talleres|no (hay|tenemos) (talleres|eventos) (programados|abiertos))\b/.test(
    foldForSearch(text ?? "")
  );
