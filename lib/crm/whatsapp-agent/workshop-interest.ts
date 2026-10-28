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
 * es y de qué trata, y la llamada con Dayana para inscribirse. Vale también
 * para quien ya tuvo su llamada gratis o solo se inscribió al webinar. Y Dayana
 * ve la lista de interesadas en el taller (`workshop-interests.ts`).
 *
 * Desde el 25-oct (dueña: «que el modelo envíe el enlace de pago pero que
 * pregunte si para separar su cupo o agendar, ya que algunos pueden querer
 * separar su cupo ya»), si el taller tiene su enlace de pago (`payUrl`), la
 * pregunta es esa: ¿separa su cupo de una vez (el enlace, que pega el código)
 * o agenda primero la llamada? Quien ya dice que quiere pagar o pide el
 * enlace lo recibe sin la pregunta. El valor lo ve en el enlace.
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
  /**
   * El enlace de pago de la edición (`…/pagar/p/taller-<slug>`), solo con su
   * producto activo y con precio (`openWorkshopForAi`). Sin él, la inscripción
   * es solo con la llamada, como antes.
   */
  payUrl?: string | null;
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
  // Con «taller», el día solo también es esta edición (Sergio, 25-oct: «Para el taller de el 15»).
  const day = Boolean(dm && new RegExp(`\\b${dm.day}\\b`).test(t));
  return words.some(has) || date || day || INTEREST.test(t);
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
/** ¿Habla de su propio proceso (la terapia, sus sesiones, su paquete)? */
export const aboutOwnProcess = (text: string): boolean => OWN_PROCESS.test(foldForSearch(text));
/** Cuántos mensajes nuestros se miran hacia atrás buscando la oferta (país, ciudad, horas, «¿cuál de estas?»…). */
const MAX_STEPS = 6;
const DAY_MS = 24 * 3600_000;

/**
 * Nuestra oferta de la llamada para inscribirse: el mensaje de la lista de
 * interesadas, o uno que habla del taller y de la llamada para inscribirse o
 * separar el cupo (la pregunta del cupo o la llamada también la ofrece).
 */
export const isWorkshopOffer = (l: Line, w: OpenWorkshop): boolean => {
  if (l.direction !== "OUTBOUND") return false;
  if (isOutreach(l, w)) return true;
  const t = foldForSearch(l.body ?? "");
  return namesWorkshop(t, w) && /\bllamada\b/.test(t) && /\binscri(b|p)|\bcupo\b/.test(t);
};

/** El enlace de pago de un taller, dentro de un texto (`/pagar/p/taller-<slug>`). */
const WORKSHOP_PAY_URL = /\S*\/pagar\/p\/taller-[^\s)\]]*/gi;

/**
 * La pregunta del cupo o la llamada (dueña, 25-oct: «que pregunte si para
 * separar su cupo o agendar»). El valor no lo decimos: lo ve en el enlace.
 */
export const WORKSHOP_CHOICE =
  "¿Quieres separar tu cupo ya con el enlace de pago (ahí ves el valor) o agendar primero una llamada con Dayana?";

/** ¿Este mensaje le pregunta si separa su cupo (el enlace de pago) o agenda la llamada? */
export const isWorkshopChoice = (text: string | null | undefined): boolean => {
  const t = foldForSearch(text ?? "");
  return /\bcupo\b/.test(t) && /\b(llamada|agendar)\b/.test(t) && /\b(enlace|link|pago|pagar)\b/.test(t) && /\?/.test(text ?? "");
};

const SPOT =
  /\b(cupo|cupos|separ(ar|arlo|arla|arme|ame|o|e)|reserv(ar|arlo|arla|arme|ame|o|e)|pagar|pagarlo|pagarla|pago|paga|pagas|pagamos|pagaria|link|enlace|transferencia|consignar|consignacion|tarjeta|paypal|nequi|pse)\b/;
/** Todavía no, o no puede: no es elegir el cupo ahora. */
// «Después pago», «la otra semana» o «¿me respetan la promoción si pago después?» sí
// llevan el enlace (dueña, 25-oct, Sergio: «tiene que enviar lo del taller»); no poder pagar, no.
const NOT_NOW = /\b(no (puedo|tengo|me alcanza|se)|todavia no|aun no|pensarlo|lo pienso)\b/;
/** Prefiere hablar antes con Dayana (o mezcla las dos cosas): lo decide el modelo. */
const WANTS_CALL = /\b(llamada|llamar|llamame|agend\w*|hablar|explique|explica)\b/;
/** Ya pagó: lo lleva el comprobante, no el enlace otra vez. */
const PAID_OR_TERMS = /\b(ya (pague|transferi|consigne|deposite|hice el pago|realice el pago)|pague|transferi|comprobante)\b/;
/** Pregunta el valor (no «vale», que también es «de acuerdo»). */
const PRICE = /\b(valor|precio|precios|costo|costos|cuesta|cuestan|cuanto (vale|valen|es|sale|seria|queda))\b/;
/** No puede pagarlo (no «no puedo ver el valor»). */
const CANT_PAY = /\b(no (puedo|podria) pagar\w*|no tengo (plata|dinero|con que)|no me alcanza)\b/;

/**
 * ¿Habla de pagar el taller o elige su cupo? «Quiero separar mi cupo», «¿cómo
 * pago?», «el enlace», «después pago», «¿se puede en cuotas?»; tras nuestra
 * pregunta del cupo o la llamada (`afterChoice`), también «la primera», «1» o
 * preguntar el valor, que está en el enlace (Claudia, 26-oct: «No he podido ver
 * cuál es el valor del taller» y la IA le volvió a preguntar si quería el enlace).
 * No «no puedo pagar», «prefiero la llamada» ni «ya pagué».
 */
export const wantsWorkshopSpot = (said: string, opts: { afterChoice?: boolean } = {}): boolean => {
  const t = foldForSearch(said).trim();
  if (!t || PAID_OR_TERMS.test(t) || WANTS_CALL.test(t)) return false;
  if (opts.afterChoice && PRICE.test(t) && !CANT_PAY.test(t)) return true;
  if (NOT_NOW.test(t)) return false;
  if (opts.afterChoice && t.length <= 30 && /^(la |el |lo |opcion )?(1|uno|primer[ao]?)\b(?!\s*pregunta)/.test(t)) return true;
  return SPOT.test(t);
};

/** «Aquí tienes el enlace», «te envío el link» (no la pregunta «¿te envío el enlace…?»). */
export const promisesWorkshopLink = (text: string): boolean => {
  const t = foldForSearch(text.replace(/¿[^?]*\?/g, ""));
  return /\b(aqui (tienes|esta|te dejo|va)|te (envio|comparto|dejo|paso|mando)|abajo|debajo)\b[^.?!\n]{0,40}\b(enlace|link)\b/.test(t);
};

/** El enlace del taller que el modelo escribió a mano: se quita (el de verdad lo pega el código). */
export const withoutWorkshopPayUrls = (text: string): { text: string; had: boolean } => {
  const cleaned = text.replace(WORKSHOP_PAY_URL, "");
  if (cleaned === text) return { text, had: false };
  return {
    text: cleaned
      .split("\n")
      .map((l) => l.replace(/[ \t]+$/, ""))
      .join("\n")
      .replace(/[ \t]{2,}/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim(),
    had: true,
  };
};

/** Ya le mandamos el enlace de pago del taller (24 h). */
export const workshopLinkSent = (lines: Line[], now = Date.now()): boolean =>
  lines.some(
    (l) => l.direction === "OUTBOUND" && /\/pagar\/p\/taller-/i.test(l.body ?? "") && (!l.sentAt || l.sentAt.getTime() >= now - DAY_MS)
  );

/** Lo que recibe quien elige separar su cupo (el enlace va debajo). */
export const workshopLinkReply = (w: OpenWorkshop, opts: { handoff?: boolean; promo?: boolean } = {}): string =>
  opts.promo
    ? // La promoción que Dayana dio en el webinar (Sergio, 25-oct: «las 4 clases gratis»): la IA no la
      // conoce, nunca la confirma; Dayana sí. El enlace va ya: a veces la promoción dura un día.
      `La promoción te la confirma Dayana por aquí 🙏 Para que no la pierdas, aquí tienes el enlace para separar tu cupo en el taller «${w.title}»: ahí ves el valor y puedes pagar en línea.`
    : opts.handoff
      ? // Preguntó algo que solo Dayana sabe (cuotas, un descuento): el enlace y Dayana le contesta.
        `Tu pregunta se la paso a Dayana y te confirma por aquí 🙏 Mientras, aquí tienes el enlace para separar tu cupo en el taller «${w.title}»: ahí ves el valor y puedes pagar en línea.`
      : `Claro 🙏 Aquí tienes el enlace para separar tu cupo en el taller «${w.title}». Ahí ves el valor y puedes pagar en línea; con el pago tu cupo queda separado.`;

/**
 * ¿Habla de una promoción? En los webinars Dayana regala promociones (dueña,
 * 25-oct: «a veces las personas dicen voy a pagar esto con esta promoción… el
 * modelo no tiene contexto porque es algo que se habla en la reunión»).
 */
const PROMO = /\b(promo|promos|promocion|promociones|regalo|regalan|regalaron|regalaste|bono|bonos|obsequio|beneficio|clases gratis|sesiones gratis|descuento|oferta)\b/;
export const mentionsPromo = (text: string): boolean => PROMO.test(foldForSearch(text));


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
export const workshopWhen =(w: OpenWorkshop, withSchedule = true): string => {
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

/** Lo que le preguntamos después de contarle del taller: el cupo o la llamada; sin enlace de pago, la llamada. */
const nextStep = (w: OpenWorkshop): string => (w.payUrl ? WORKSHOP_CHOICE : `${ENROLL} ¿Quieres que te la separe?`);

/**
 * Lo que la IA le escribe cuando Dayana toca «Que la IA le escriba» en la lista
 * de interesadas (dueña, 24-oct: «para que Dayana sepa cuáles son y llamarles o
 * agendarles por el modelo»): el taller y la pregunta del cupo o la llamada
 * (25-oct; antes iban horas para la llamada). Lo que conteste lo sigue la IA.
 * Solo un nombre seguro.
 */
export const workshopOfferText = (w: OpenWorkshop, opts: { firstName: string | null }): string => {
  const hi = opts.firstName ? `Hola ${opts.firstName} 🙏` : "Hola 🙏";
  return `${hi} ${aboutWorkshop(w, true)} ${nextStep(w)}`;
};

/**
 * Fuera de las 24 h va en la plantilla `retomar_conversacion` («Hola {{nombre}},
 * te bendigo 💛 Te escribo para retomar nuestra conversación. {{mensaje}} Quedo
 * atenta…»): una sola línea.
 */
export const workshopOfferTemplateMessage = (w: OpenWorkshop): string => {
  const ask = nextStep(w);
  // Si no cabe, sin el horario; luego sin la fecha: la pregunta del final nunca se corta.
  const short = (title: string) =>
    w.payUrl
      ? `Sobre el taller «${title}»: está abierto. ${ask}`
      : `Sobre el taller «${title}»: está abierto. La inscripción es con una llamada con Dayana. ¿Quieres que te la separe?`;
  const options = [`${aboutWorkshop(w, true)} ${ask}`, `${aboutWorkshop(w, false)} ${ask}`, short(w.title)];
  const fits = options.find((m) => m.length <= TEMPLATE_MAX);
  if (fits) return fits;
  // Un título larguísimo: se acorta el título, no la pregunta.
  const room = TEMPLATE_MAX - short("").length - 1;
  return short(`${w.title.slice(0, Math.max(room, 0)).trimEnd()}…`);
};

/** La línea del prompt cuando pregunta por el taller (solo entonces: el prompt fijo no cambia). */
export const workshopLine = (w: OpenWorkshop, opts: { upcomingLabel: string | null }): string =>
  [
    `PREGUNTA POR EL TALLER: ${workshopFacts(w)}. ${w.cardSummary ? `De qué trata: ${w.cardSummary.trim()} ` : ""}En 2 o 3 frases cortas (unas 50 palabras en total): dile que sí está abierto, cuándo es y, en pocas palabras, de qué trata.`,
    w.payUrl
      ? opts.upcomingLabel
        ? `Ya tiene su llamada con Dayana (${opts.upcomingLabel}): dile que en esa llamada Dayana le explica todo. No le ofrezcas otra. Si quiere separar su cupo de una vez, usa send_workshop_link.`
        : `Luego pregúntale si quiere separar su cupo de una vez (le mandas el enlace de pago con send_workshop_link) o prefiere agendar primero una llamada con Dayana para que le explique todo (también si ya tuvo su llamada gratis o solo se inscribió al webinar). Si ya dijo que quiere separar su cupo, pagar o pide el enlace, usa send_workshop_link de una vez, sin preguntar. Si elige la llamada, sigue el agendamiento de siempre (si no sabes desde qué país escribe, pregúntalo primero; luego offer_free_call_slots y book_free_call).`
      : opts.upcomingLabel
        ? `Ya tiene su llamada con Dayana (${opts.upcomingLabel}): dile que en esa llamada Dayana le explica todo y la inscribe. No le ofrezcas otra.`
        : "La inscripción es con una llamada con Dayana (también si ya tuvo su llamada gratis o solo se inscribió al webinar): ofrécele separarla y, cuando diga que sí, sigue el agendamiento de siempre (si no sabes desde qué país escribe, pregúntalo primero; luego offer_free_call_slots y book_free_call).",
    w.payUrl
      ? "No digas el valor ni escribas enlaces: el valor lo ve en el enlace, que pega el código. Es otra cosa distinta a su proceso: no le mandes el enlace ni los datos de su proceso."
      : "No le des el valor ni enlaces de pago: se los da Dayana en la llamada. Es otra cosa distinta a su proceso: no le mandes el enlace ni los datos de su proceso.",
  ].join(" ");

/**
 * La línea del prompt mientras sigue lo del taller (el «sí», el país, la hora).
 * Según lo último que le escribimos del taller: ya le mandamos el enlace, le
 * preguntamos por el cupo o la llamada, o le ofrecimos solo la llamada (los
 * mensajes de antes del 25-oct: ahí «sí» es la llamada).
 */
export const workshopFollowLine = (lines: Line[], w: OpenWorkshop, now = Date.now()): string => {
  const hours =
    "dale horas ya con offer_free_call_slots (sin preguntarle qué día prefiere; si no sabes desde qué país escribe, pregúntalo primero) y, cuando elija una, book_free_call";
  if (!w.payUrl) {
    return `SIGUE LO DEL TALLER: está separando su llamada con Dayana para inscribirse al taller «${w.title}» (ya se la ofrecimos). Si dice que sí, ${hours}. No le des el valor ni enlaces de pago.`;
  }
  if (workshopLinkSent(lines, now)) {
    return `SIGUE LO DEL TALLER: ya le mandaste el enlace de pago para separar su cupo en el taller «${w.title}». Contesta sus dudas; no se lo mandes otra vez salvo que lo pida (send_workshop_link). Si prefiere hablar antes con Dayana, ${hours}. Si dice que ya pagó o manda el comprobante, register_payment_receipt. No digas el valor.`;
  }
  const lastOffer = [...lines].reverse().find((l) => l.direction === "OUTBOUND" && namesWorkshop(l.body ?? "", w));
  if (lastOffer && isWorkshopChoice(lastOffer.body)) {
    return `SIGUE LO DEL TALLER «${w.title}»: le preguntamos si quiere separar su cupo de una vez (el enlace de pago) o agendar primero una llamada con Dayana. Si elige el cupo, pagar o el enlace, o pregunta el valor (está en el enlace): send_workshop_link (va debajo; no lo escribas). Si elige la llamada: ${hours}. Si no queda claro cuál prefiere, pregúntaselo. No digas el valor: lo ve en el enlace.`;
  }
  return `SIGUE LO DEL TALLER: está separando su llamada con Dayana para inscribirse al taller «${w.title}» (ya se la ofrecimos). Si dice que sí, ${hours}. Si prefiere separar su cupo de una vez o pide pagar, send_workshop_link. No digas el valor.`;
};

/**
 * La línea del prompt cuando habla de pagar el taller y la conversación ya no lo
 * nombra (preguntó por él en las últimas 24 h; Sergio, 25-oct: «Es que es
 * respecto al pago»). Lo que no sabe (la promoción de la clase, cuotas) lo
 * contesta Dayana; el enlace va igual.
 */
export const workshopPayLine = (w: OpenWorkshop): string =>
  `PAGO DEL TALLER: habla de pagar el taller «${w.title}» (o de la promoción que Dayana dio en el webinar). Mándale el enlace de pago con send_workshop_link (va debajo; no lo escribas) en un mensaje corto: ahí ve el valor y paga en línea. Si pregunta por una promoción o algo que no sabes (cuotas, un descuento), mándale el enlace igual y escala con category=payment para que Dayana se lo confirme; nunca confirmes tú una promoción ni le digas solo que lo consultas. No digas el valor ni le ofrezcas la llamada para pagar.`;

/** La respuesta del código si el modelo dice que no hay taller o se lo pasa a Dayana. */
export const workshopReply = (w: OpenWorkshop, opts: { upcomingLabel: string | null }): string => {
  const facts = workshopFacts(w);
  const open = `Sí, ${facts.replace(/^el taller («[^»]+»)( es )?/, (_, title: string, es?: string) => `el taller ${title} está abierto${es ? ": es " : ""}`)}.`;
  if (w.payUrl) {
    return opts.upcomingLabel
      ? `${open} En tu llamada con Dayana (${opts.upcomingLabel}) ella te explica todo. Si quieres separar tu cupo de una vez, dime y te envío el enlace de pago.`
      : `${open} ${WORKSHOP_CHOICE}`;
  }
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
 *
 * Con enlace de pago (25-oct), lo que no puede faltar es la pregunta del cupo
 * o la llamada: si el modelo no la hizo, reemplaza su pregunta del final
 * («¿Desde qué país me escribes?» es para agendar, todavía no eligió). Si ya
 * va el enlace (eligió el cupo), su texto sale tal cual.
 */
export const withWorkshopStep = (text: string, w: OpenWorkshop, opts: { upcomingLabel: string | null; linkSent?: boolean }): string => {
  const t = foldForSearch(text);
  const saysOpen = /\babiert[oa]s?\b/.test(t);
  if (w.payUrl && opts.linkSent) return text;
  if (w.payUrl && !opts.upcomingLabel) {
    const hasChoice = isWorkshopChoice(text);
    if (hasChoice && saysOpen) return text;
    const body = text.trim();
    const q = body.lastIndexOf("¿");
    const tailQ = q >= 0 && body.endsWith("?") && !body.slice(q).includes("\n");
    const head = tailQ ? body.slice(0, q).trimEnd() : body;
    const join = (a: string, b: string) => (a ? `${a}${/[.!?:]$/.test(a) ? " " : ". "}${b}` : b);
    // Ya pregunta por el cupo o la llamada: solo falta «abiertas», antes de la pregunta.
    if (hasChoice) return tailQ ? join(join(head, "Las inscripciones están abiertas."), body.slice(q)) : join(body, "Las inscripciones están abiertas.");
    // Su pregunta del final (una sola línea) la reemplaza la del cupo o la llamada.
    return join(head, `${saysOpen ? "" : "Las inscripciones están abiertas. "}${WORKSHOP_CHOICE}`);
  }
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
