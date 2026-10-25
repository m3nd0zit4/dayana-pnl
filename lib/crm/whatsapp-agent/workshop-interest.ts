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
/** Lo de su proceso, no del taller («¿puedo pagar la terapia el 15 de noviembre?»). */
const HER_PROCESS = /\b(sesion|sesiones|terapia|terapias|cita|llamada|paquete|pago|pagar|pague|comprobante)\b/;

export const isWorkshopAsk = (text: string | null | undefined, w: OpenWorkshop): boolean => {
  const t = foldForSearch(text ?? "");
  const words = titleWords(w.title);
  const has = (x: string) => new RegExp(`\\b${x}\\b`).test(t);
  const dm = dayMonth(w);
  const date = Boolean(dm && new RegExp(`\\b${dm.day}\\b[^.?!]{0,8}\\b${dm.month}\\b`).test(t));
  if (!/\b(taller|talleres|workshop)\b/.test(t)) {
    // Sin «taller»: el título entero («¿cuánto cuesta la sanación con el dinero?»)
    // o la fecha con una pregunta y nada de su proceso. Una palabra sola no
    // («no tengo dinero para la terapia»).
    return !HER_PROCESS.test(t) && ((words.length >= 2 && words.every(has)) || (date && INTEREST.test(t)));
  }
  // «taller de X» con una X que no es de este taller: es otro.
  const of = /\btaller(?:es)? de (?:la |el |los |las )?([a-z0-9ñ]+)/.exec(t);
  if (of && !words.includes(of[1]) && !MONTHS.includes(of[1]) && !/^\d/.test(of[1]) && !["dayana", "pnl"].includes(of[1])) return false;
  return words.some(has) || date || INTEREST.test(t);
};

type Line = { direction: string; body: string | null; sentAt?: Date | null; source?: string | null };

/**
 * El mensaje que la IA le manda cuando Dayana toca «Ofrecerle la llamada» en
 * la lista de interesadas (`offerWorkshopCall`). Lleva su `source` para que la
 * respuesta («sí», «la 2») siga el agendamiento aunque haya preguntado hace días.
 */
// No empieza por «taller:»: eso es un envío masivo (`isAutoSend`); este lo escribe la asistente a una persona.
export const workshopOutreachSource = (w: Pick<OpenWorkshop, "id">): string => `asistente:taller:${w.id}`;
/** Contesta a ese mensaje hasta 3 días después (lo que duran las horas ofrecidas). */
const OUTREACH_FRESH_MS = 72 * 3600_000;
const isOutreach = (l: Line, w: OpenWorkshop) => l.direction === "OUTBOUND" && l.source === workshopOutreachSource(w);

/** Le escribimos por el taller desde la lista de interesadas en los últimos 3 días. */
export const workshopOutreachRecent = (lines: Line[], w: OpenWorkshop, now = Date.now()): boolean =>
  lines.some((l) => isOutreach(l, w) && (!l.sentAt || l.sentAt.getTime() >= now - OUTREACH_FRESH_MS));

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

/** Está en lo del taller: preguntó (24 h) o le escribimos desde la lista de interesadas (3 días). */
export const workshopLeadActive = (lines: Line[], w: OpenWorkshop, now = Date.now()): boolean =>
  workshopAskedRecently(lines, w, now) || workshopOutreachRecent(lines, w, now);

/** Un mensaje nuestro que habla del taller: «taller», la inscripción, el título o la fecha. */
const namesWorkshop = (text: string, w: OpenWorkshop): boolean => {
  const t = foldForSearch(text);
  const dm = dayMonth(w);
  return (
    /\b(taller|inscri\w*)\b/.test(t) ||
    titleWords(w.title).some((x) => new RegExp(`\\b${x}\\b`).test(t)) ||
    Boolean(dm && new RegExp(`\\b${dm.day}\\b[^.?!]{0,8}\\b${dm.month}\\b`).test(t))
  );
};
/**
 * Los pasos del agendamiento entre la oferta y la hora elegida: el país, la
 * ciudad, la lista de horas (`offerMessage`), «¿Cuál de estas?», «Esa hora ya
 * no está libre».
 */
const FLOW_STEP = /\b(desde que pais|en que ciudad|cual te queda mejor|responderme con el numero|cual de estas|ya no esta libre|horas libres)\b/;
/** Lo de su propio proceso («¿a qué cuenta pago mi terapia?»): esa respuesta no sigue lo del taller. */
const OWN_PROCESS = /\b(sesion|sesiones|terapia|terapias|paquete|proceso|comprobante|transferi\w*)\b/;
/** Cuántos mensajes nuestros se miran hacia atrás buscando la oferta (país, ciudad, horas, «¿cuál de estas?»…). */
const MAX_STEPS = 6;
const DAY_MS = 24 * 3600_000;

/** Nuestra oferta de la llamada para inscribirse: el mensaje de la lista de interesadas, o uno que habla del taller y de la inscripción por llamada. */
export const isWorkshopOffer = (l: Line, w: OpenWorkshop): boolean => {
  if (l.direction !== "OUTBOUND") return false;
  if (isOutreach(l, w)) return true;
  const t = foldForSearch(l.body ?? "");
  return namesWorkshop(t, w) && /\bllamada\b/.test(t) && /\binscri(b|p)/.test(t);
};

/**
 * La llamada para el taller (aunque ya haya tenido su llamada gratis) solo
 * mientras habla del taller: lo pregunta ahora, o lo último que le escribimos
 * habla del taller (la oferta de la llamada para inscribirse), quizá seguido de
 * los pasos del agendamiento (país, ciudad, listas de horas). Revisión 24-oct:
 * durante 24 h, un «gracias» o una pregunta de su sesión abría el embudo de la
 * llamada; y un «¿te la separo?» o una lista de horas que no eran del taller lo
 * reabrían. El mensaje de la lista de interesadas cuenta como la oferta durante
 * 3 días; tras él, «¿desde qué país?» y «Perú» siguen en el taller (revisión:
 * con solo los dos últimos mensajes, el paso del país lo cerraba).
 */
export const workshopFlowActive = (lines: (Line & { isAutoReply?: boolean })[], w: OpenWorkshop, now = Date.now()): boolean => {
  if (!workshopLeadActive(lines, w, now)) return false;
  const tail: string[] = [];
  const outs: Line[] = [];
  for (const l of [...lines].reverse()) {
    if (l.direction === "INBOUND") {
      if (outs.length === 0 && l.body) tail.unshift(l.body);
      continue;
    }
    outs.push(l);
    if (outs.length === MAX_STEPS) break;
  }
  const said = tail.join("\n");
  if (isWorkshopAsk(said, w)) return true;
  if (OWN_PROCESS.test(foldForSearch(said))) return false;
  const within = (l: Line, ms: number) => !l.sentAt || l.sentAt.getTime() >= now - ms;
  for (const o of outs) {
    const body = o.body ?? "";
    if (namesWorkshop(body, w)) return within(o, isOutreach(o, w) ? OUTREACH_FRESH_MS : DAY_MS);
    if (!FLOW_STEP.test(foldForSearch(body)) || !within(o, DAY_MS)) return false;
  }
  return false;
};

/** «8:30 a.m. – 4:30 p.m. · virtual» → «8:30 a. m. – 4:30 p. m., virtual». */
const tidySchedule = (s: string) =>
  s
    .replace(/\b([ap])\.?\s?m\.?/gi, (_, x: string) => `${x.toLowerCase()}. m.`)
    .replace(/\s*·\s*/g, ", ")
    .trim();

/** «el taller «Tu Sanación con el Dinero» es el domingo 15 de noviembre, 8:30 a. m. – 4:30 p. m., virtual (hora de Colombia)». */
export const workshopFacts = (w: OpenWorkshop): string => {
  const when = workshopWhen(w);
  return `el taller «${w.title}»${when ? ` es el ${when} (hora de Colombia)` : ""}`;
};

/** «domingo 15 de noviembre, 8:30 a. m. – 4:30 p. m., virtual»; sin el horario con `withSchedule: false`. */
const workshopWhen = (w: OpenWorkshop, withSchedule = true): string => {
  const date = w.startsAt
    ? new Intl.DateTimeFormat("es-CO", { timeZone: w.timezone, weekday: "long", day: "numeric", month: "long" }).format(w.startsAt).replace(",", "")
    : (w.dateLabel ?? "").trim();
  return [date, withSchedule && w.scheduleLabel ? tidySchedule(w.scheduleLabel) : null].filter(Boolean).join(", ");
};

/** Lo que cabe en la variable de la plantilla `retomar_conversacion` (`MENSAJE_MAX`). */
const TEMPLATE_MAX = 300;
const ENROLL = "La inscripción es con una llamada con Dayana, donde te explica todo.";
const aboutWorkshop = (w: OpenWorkshop, withSchedule: boolean): string => {
  const when = workshopWhen(w, withSchedule);
  return `Sobre el taller «${w.title}» por el que preguntaste: está abierto${when ? ` y es el ${when} (hora de Colombia)` : ""}.`;
};

/**
 * Lo que la IA le escribe cuando Dayana toca «Ofrecerle la llamada» en la lista
 * de interesadas (dueña, 24-oct: «para que Dayana sepa cuáles son y llamarles o
 * agendarles por el modelo»). Dentro de las 24 h: el taller y la lista de horas
 * que pinta el código (`offerList`), así «la 2» la agenda sola; sin horas, la
 * pregunta. Solo un nombre seguro.
 */
export const workshopOfferText = (w: OpenWorkshop, opts: { firstName: string | null; slotList: string | null }): string => {
  const hi = opts.firstName ? `Hola ${opts.firstName} 🙏` : "Hola 🙏";
  const ask = opts.slotList ? ` Estas son las horas libres de Dayana para la llamada:\n\n${opts.slotList}` : " ¿Quieres que te la separe?";
  return `${hi} ${aboutWorkshop(w, true)} ${ENROLL}${ask}`;
};

/**
 * Fuera de las 24 h va en la plantilla `retomar_conversacion` («Hola {{nombre}},
 * te bendigo 💛 Te escribo para retomar nuestra conversación. {{mensaje}} Quedo
 * atenta…»): una sola línea, sin horas (pueden no seguir libres cuando conteste).
 */
export const workshopOfferTemplateMessage = (w: OpenWorkshop): string => {
  const ask = "¿Quieres que te la separe?";
  // Si no cabe, sin el horario; luego sin la fecha: la pregunta del final nunca se corta.
  const short = (title: string) => `Sobre el taller «${title}»: está abierto. La inscripción es con una llamada con Dayana. ${ask}`;
  const options = [`${aboutWorkshop(w, true)} ${ENROLL} ${ask}`, `${aboutWorkshop(w, false)} ${ENROLL} ${ask}`, short(w.title)];
  const fits = options.find((m) => m.length <= TEMPLATE_MAX);
  if (fits) return fits;
  // Un título larguísimo: se acorta el título, no la pregunta.
  const room = TEMPLATE_MAX - short("").length - 1;
  return short(`${w.title.slice(0, Math.max(room, 0)).trimEnd()}…`);
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
  // «Te agendo una llamada gratis» sin decir que es para inscribirse no basta.
  // «Separar tu cupo» con la llamada también es inscribirse (evaluación: se repetía la frase).
  const saysCall = /\bllamada\b/.test(t) && /\binscri(b|p)|\bcupo\b/.test(t);
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
  // Si ya le ofrece una llamada («te agendo una llamada gratis»), sin otra pregunta.
  return `${body}${sep}${add}${call || /\bllamada\b/.test(t) ? "" : " ¿Quieres que te la separe?"}`;
};

/** «No hay ningún taller programado» cuando sí lo hay (Noralma y Naty, 24-oct). */
export const saysNoWorkshop = (text: string | null | undefined): boolean =>
  /\b(no (hay|tenemos|tiene)( (ningun|algun))? taller|ningun taller|no hay talleres|no (hay|tenemos) (talleres|eventos) (programados|abiertos))\b/.test(
    foldForSearch(text ?? "")
  );
