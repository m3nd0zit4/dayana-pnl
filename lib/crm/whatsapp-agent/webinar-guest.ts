import { getTimeLabelInTz } from "@/lib/datetime/zoned-time";

import { foldForSearch } from "../search-normalize";

/**
 * Quien solo se inscribió a un evento gratuito y quien quiere empezar un
 * proceso con Dayana (pedido de la dueña, 22-oct).
 *
 * Miroslava, Ana, Caicedo y Alexandra se inscribieron al webinar, recibieron
 * la confirmación y contestaron «gracias», «sí asistiré», «sí puedo». No
 * buscaban una llamada, pero la asistente siguió el flujo de PERSONA NUEVA
 * (¿cómo estás?, ¿de qué país?, ¿qué te motiva?, la llamada gratis) hasta
 * agendarles una, y la agenda de Dayana se llenó de gente que no la pidió.
 * Raquel también venía del webinar, pero después escribió «quería información
 * de tu terapia»: ella sí. Xime y Claudia escribieron desde cero pidiendo
 * agendar o tratarse: ellas sí.
 *
 * Así que a quien está inscrita y no ha pedido nada personal la asistente le
 * da la bienvenida al evento y le contesta lo del evento, sin la llamada
 * gratis. En cuanto pide terapia, una sesión, un proceso, una cita o hablar
 * con Dayana (o dice que sí a una invitación), vuelve el flujo de siempre.
 *
 * Puro: lo usan `brain.ts` y las pruebas.
 */

export type GuestEvent = {
  eventLabel: string;
  headline: string;
  startsAt: Date | null;
  startsAtHasTime: boolean;
};

type Line = { direction: "INBOUND" | "OUTBOUND"; body: string | null; sentAt?: Date };

/** Lo que pidió hace más de esto ya no cuenta como «quiere un proceso ahora». */
const INTENT_WINDOW_MS = 30 * 24 * 3600_000;
/** Un evento cuenta desde la inscripción hasta una semana después de empezar. */
const AFTER_EVENT_MS = 7 * 24 * 3600_000;
/** Como en los DATOS: hasta 3 h después de empezar, el evento sigue «en pie». */
const STILL_ON_MS = 3 * 3600_000;

/**
 * Pide algo personal: terapia, una sesión, un proceso, una cita, la llamada,
 * ayuda, los valores de las terapias, o escribe con el texto de los botones de
 * WhatsApp del sitio («vengo desde la web», «te escribo desde tu página de
 * enlaces»): escribió ella, no contestó a la confirmación.
 *
 * Sueltos no cuentan: «consulta» («quería hacerle una consulta» es una
 * pregunta), «me interesa» (el webinar), «información» (la del evento),
 * «¿cuánto cuesta?» (el evento es gratis), «sesión» (la del domingo, «¿las
 * sesiones quedan grabadas?»), «el proceso» («el proceso del webinar»).
 */
const ASKS_FOR_PROCESS = new RegExp(
  [
    "\\bterapia",
    "\\btratamiento",
    "\\bacompanamiento",
    "\\basesoria (personal|personalizada|individual|privada|contigo|con (dayana|usted|ella))",
    "\\bsesion(es)? (personal|personalizada|individual|privada|contigo|con (dayana|usted|ella))",
    "\\b(agendar|tomar|empezar|iniciar|comenzar|reservar|quiero|quisiera|necesito|me gustaria|deseo|continuar en|seguir con|seguir en) (una |unas |mis |otra )?sesion(?!es grabad| grabad)",
    "\\b(empezar|iniciar|comenzar|hacer|tomar|retomar|seguir|continuar) (con )?(mi|un|el|tu|su|este|ese) proceso(?! (del|de la|de) (webinar|evento|masterclass|clase|inscripcion|registro))",
    "\\bproceso (personal|personalizado|individual|contigo|con (dayana|usted|ella|ustedes))",
    "\\bmas sobre el proceso",
    "\\bpersonalizad[oa]s?\\b",
    "(^|\\s)(1 ?a ?1|1:1|uno a uno)\\b",
    "\\b(consulta|cita|llamada) (gratis|gratuita|personal|privada|individual|contigo|con (dayana|usted|ella))",
    "\\b(agendar|sacar|pedir|tener|reservar|quiero|quisiera|me gustaria|necesito|deseo) (una |la |otra )?(consulta|cita|llamada)\\b",
    "\\bagend(ar|arme|arte|ame|amos)\\b",
    "\\bhablar (con (dayana|usted|ella)|contigo)\\b",
    "\\b(tratarme|atenderme|me atienda|me atiendas|me (puedes|puede|podrias|podria) atender|trabajar contigo|trabajar con (dayana|usted|ella))\\b",
    "\\bcuanto (cobra|cobras|cobran)\\b",
    "\\bcuanto (cuesta|vale|sale|es|cobras por) (una|la|el|cada|tu|su|tus|sus) (sesion|consulta|terapia|proceso|paquete)",
    "\\b(precio|costo|valor|tarifa)s? de (la|las|tu|tus|su|sus|una|el|los|un) (sesion|proceso|consulta|paquete|servicio)",
    "\\b(tus|sus) servicios\\b",
    // Los textos de los botones de WhatsApp del sitio (`FloatingWhatsApp`, `Footer`, `/enlaces`).
    "\\bvengo desde la web\\b",
    "\\bte escribo desde tu pagina de enlaces",
  ].join("|")
);
/** «Necesito ayuda» sí, salvo que sea con el enlace o la inscripción («no me llega el enlace, necesito ayuda»). */
const ASKS_FOR_HELP = /\b(necesito|quiero|busco|pido|requiero|quisiera) (de )?(tu |su )?ayuda\b/;
const TECH_HELP = /\b(enlace|link|meet|zoom|inscri\w*|registr\w*|entrar|conectar\w*|correo|pagina|formulario|clave)\b/;

export const asksForProcess = (text: string): boolean => {
  const t = foldForSearch(text);
  return ASKS_FOR_PROCESS.test(t) || (ASKS_FOR_HELP.test(t) && !TECH_HELP.test(t));
};

/** Lo nuestro que la invita: la llamada gratis o «te agendo con Dayana». Un «sí» después es un sí. */
const INVITES = /\bllamada (gratis|gratuita)|\bconsulta (gratis|gratuita)|\b15 minutos\b|\bte agend(o|e|amos)\b/;
const YES = /^(si|sii+|claro|dale|de una|ok|okay|bueno|listo|por favor|porfa|me encantaria)\b/;
/**
 * La puerta de la bienvenida («si quieres un proceso personalizado, me
 * escribes»): no es pregunta, un «sí, gracias» no la abre. Si la asistente la
 * dice como pregunta, con sus palabras («¿te gustaría trabajarlo con
 * Dayana?», «¿quieres que Dayana te acompañe?»), un «sí» la abre.
 */
const DOOR = /\bpersonalizad/;
const DOOR_QUESTION = (text: string) =>
  /\bpersonalizad|\bproceso\b|\bacompan\w*|\btrabaj(ar|arlo|arla|emos)\b|\bterapia/.test(text) && /\b(dayana|personalizad\w*)\b/.test(text);
/** Una pregunta nuestra sobre el evento («¿quieres el enlace?»): un «quiero» ahí no es un proceso. */
const EVENT_TALK = /\b(webinar|masterclass|evento|enlace|link|meet|hora|fecha|domingo|grabad\w*|inscri\w*)\b/;
const WANTS = /\b(me gustaria|quiero|quisiera|me interesa|me encantaria|deseo|acepto)\b(?! (ir|asistir|estar|participar|conectarme|entrar|verla|verte|escucharla|escucharte|el webinar|la masterclass|el evento))/;

const clean = (text: string) => foldForSearch(text).replace(/[,.!¡¿?]+/g, " ").replace(/\s+/g, " ").trim();

/**
 * Pidió algo personal en el último mes: lo escribió ella, o dijo que sí a una
 * invitación nuestra (la llamada gratis, «te agendo con Dayana»), o contestó
 * «me gustaría / me interesa» a la puerta de la bienvenida (o «sí» si la
 * puerta fue una pregunta: «¿quieres un proceso personalizado con Dayana?»).
 */
export const wantsProcess = (lines: Line[], now = Date.now()): boolean => {
  let lastOut: { text: string; asks: boolean } | null = null;
  for (const line of lines) {
    const text = clean(line.body ?? "");
    if (!text) continue;
    if (line.direction === "OUTBOUND") {
      lastOut = { text, asks: (line.body ?? "").includes("?") };
      continue;
    }
    if (line.sentAt && line.sentAt.getTime() < now - INTENT_WINDOW_MS) continue;
    if (asksForProcess(text)) return true;
    if (lastOut && INVITES.test(lastOut.text) && (YES.test(text) || WANTS.test(text))) return true;
    if (lastOut && DOOR.test(lastOut.text) && WANTS.test(text)) return true;
    if (lastOut && lastOut.asks && DOOR_QUESTION(lastOut.text) && YES.test(text)) return true;
    if (lastOut && lastOut.asks && !EVENT_TALK.test(lastOut.text) && WANTS.test(text)) return true;
  }
  return false;
};

/** El evento todavía cuenta para esta persona: no ha empezado, o empezó hace menos de una semana. */
export const guestEventCounts = (event: Pick<GuestEvent, "startsAt">, now = Date.now()): boolean =>
  !event.startsAt || event.startsAt.getTime() > now - AFTER_EVENT_MS;

const eventPassed = (event: GuestEvent, now: number) => Boolean(event.startsAt && event.startsAt.getTime() < now - STILL_ON_MS);

const dayLabel = (d: Date, tz: string) =>
  new Intl.DateTimeFormat("es-CO", { timeZone: tz, weekday: "long", day: "numeric", month: "long" }).format(d);

const whenLabel = (event: GuestEvent, tz: string) => {
  if (!event.startsAt) return "fecha por anunciar";
  const day = dayLabel(event.startsAt, tz);
  return event.startsAtHasTime ? `${day}, ${getTimeLabelInTz(event.startsAt, tz)} hora de Colombia` : day;
};

/** «Webinar Gratuito» o «Masterclass Gratuita «Reprograma tu mente con PNL»». */
const eventName = (event: GuestEvent) =>
  foldForSearch(event.headline.trim()) === foldForSearch(event.eventLabel.trim())
    ? `«${event.headline.trim()}»`
    : `${event.eventLabel.trim()} «${event.headline.trim()}»`;

const DOOR_LINE = "Si en algún momento quieres un proceso personalizado con Dayana, me escribes por aquí.";

/** Ya se le dijo la puerta o se le dio la bienvenida al evento (en lo que lee la IA). */
const saidBefore = (lines: Line[], what: RegExp) =>
  lines.some((l) => l.direction === "OUTBOUND" && what.test(foldForSearch(l.body ?? "")));
const WELCOMED = /\b(te esperamos|te damos la bienvenida|bienvenid[oa]s? al)\b/;

/** La línea del prompt que reemplaza «YA HECHO / SIGUIENTE PASO» del flujo de venta. */
export const guestLine = (event: GuestEvent, lines: Line[], opts: { timezone: string; now?: number }): string => {
  const now = opts.now ?? Date.now();
  const name = eventName(event);
  const passed = eventPassed(event, now);
  const door = saidBefore(lines, DOOR) ? "" : ` Si no se lo dijiste antes, cierra con: «${DOOR_LINE}»`;
  return [
    `INSCRITA EN UN EVENTO GRATUITO, SIN PEDIR NADA PERSONAL: se inscribió en ${name} (${whenLabel(event, opts.timezone)})${passed ? ", que ya pasó," : ""} y no ha pedido terapia, una sesión, un proceso, una cita ni hablar con Dayana. A esta persona NO le aplica el flujo de PERSONA NUEVA ni la llamada gratis:`,
    "- No le ofrezcas la llamada gratis ni horas. No le preguntes cómo está, de qué país o ciudad escribe, qué la motiva, qué le pasa ni qué busca: nada de preguntas para venderle.",
    passed
      ? `- Si agradece o comenta el evento, agradécele con calidez, corto.${door}`
      : `- Si solo agradece o confirma que va, dale la bienvenida y dile que la esperamos, corto, así: «Con gusto. Te damos la bienvenida: te esperamos en ${name} el ${event.startsAt ? dayLabel(event.startsAt, opts.timezone) : "día del evento"}. Te bendigo 🙏».${door}`,
    "- Si pregunta algo del evento (la hora en su país, el enlace, si queda grabado), contéstalo con los DATOS y CLIENTA EN EL CRM.",
    "- Si cuenta algo que le pasa o pide algo personal, dile con calidez que eso es justo lo que Dayana trabaja y pregúntale si quiere un proceso personalizado con Dayana (sin agendar nada todavía).",
  ].join("\n");
};

/**
 * La respuesta de la IA la mete en el embudo que no pidió: la llamada gratis,
 * agendarla, ¿cómo estás?, ¿de qué país?, ¿qué te motiva?, la pregunta clave.
 * Preguntar el país sí vale si preguntó la hora (para decírsela en la suya).
 */
const FUNNEL = [
  // El evento no es una llamada: «una / la / esa llamada» es la gratis («¿revisemos una
  // fecha para esa llamada?», eval 22-oct); «no es una llamada» habla del evento.
  /(?<!\bno es )\b(una|la|tu|esa|otra|tus|las) llamadas?\b|\bllamada (gratis|gratuita)|\b(consulta|sesion) (gratis|gratuita)|\b15 minutos\b/,
  /\b(te |la |lo )?agend(o|e|amos|emos|ar|arte|arla|arlo)\b|\bun espacio (con|para hablar)\b/,
  /\bcomo (estas|te sientes|te has sentido|te encuentras|vas)\b/,
  /\bque te (motiva|motivo|llevo|trae|trajo|impulso|animo|gustaria (trabajar|sanar|transformar|cambiar|mejorar))\b/,
  /\bque (situacion|emocion)\b|\bque (es lo que )?(estas buscando|buscas)\b|\bcuanto tiempo mas\b|\bcuentame (que|como|un poco|mas)\b/,
];
const COUNTRY = /\b(desde|de) que (pais|ciudad)|\bde donde (me |nos )?(escribes|eres)|\ben que (pais|ciudad)\b|\bque ciudad de\b/;
const ASKS_TIME = /\b(hora|horario|a que hora)\b/;

export const funnelsGuest = (reply: string, lastInbound: string[]): boolean => {
  const text = foldForSearch(reply);
  if (FUNNEL.some((re) => re.test(text))) return true;
  return COUNTRY.test(text) && !ASKS_TIME.test(foldForSearch(lastInbound.join(" ")));
};

/** Solo agradece o confirma que va («Gracias», «Si asistire», «Ok, ahí estaré», un emoji), sin preguntar nada. */
const ACK = /\b(gracias|ok|okey|okay|listo|perfecto|super|genial|excelente|amen|bendicion\w*|dios (te|la|le|los) bendiga|asistire|asistir|estare|estaremos|ire|alli|ahi|me conecto|me apunto|confirmo|claro|si puedo|si)\b/;

/**
 * Eso pide una respuesta, no la bienvenida: «Sí, pero no sé si pueda por el
 * trabajo», «quiero saber si es en vivo», «ok y el enlace» (revisión 22-oct).
 */
const NOT_ACK =
  /\b(pero|aunque|no (puedo|podre|pueda|se)|problema|duda|que|como|cuando|donde|cual|quien|saber|si es|enlace|link|meet|zoom|hora|fecha|grabad\w*|precio|costo|cuanto|vivo|puedo|puede|hay|tiene)\b/;

export const acknowledgesOnly = (lastInbound: string[]): boolean => {
  const raw = lastInbound.join(" ");
  if (/[?¿]/.test(raw)) return false;
  const text = clean(raw).replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
  if (!text) return lastInbound.length > 0;
  return text.split(" ").length <= 8 && ACK.test(text) && !NOT_ACK.test(text.replace(/\bsi puedo\b/g, "")) && !asksForProcess(text);
};

const SENTENCES = /(?<=[.!?…])\s+|\n+/;
const ASKS_WHEN = /\b(fecha|hora|horario|cuando|que dia)\b/;

/**
 * Lo que sale en vez de la respuesta del modelo (null: sale la del modelo):
 * - la mete en el embudo y preguntó algo del evento: la respuesta sin esas
 *   frases («Es el domingo 25 a las 9:30 a. m. ¿Desde qué país me escribes?»);
 * - la mete en el embudo y no queda nada, o solo agradecía: la bienvenida;
 * - antes del evento, solo agradeció y la respuesta no le da la bienvenida que
 *   todavía no se le dio («Con gusto. Te bendigo» a secas, eval 22-oct): la
 *   bienvenida.
 */
export const guestReply = (
  event: GuestEvent,
  reply: string,
  lastInbound: string[],
  lines: Line[],
  opts: { firstName: string | null; timezone: string; now?: number }
): string | null => {
  const now = opts.now ?? Date.now();
  const welcome = () => guestWelcome(event, lines, { ...opts, now });
  const ack = acknowledgesOnly(lastInbound);
  if (funnelsGuest(reply, lastInbound)) {
    const kept = reply
      .split(SENTENCES)
      .filter((s) => s.trim() && !funnelsGuest(s, lastInbound))
      .join(" ")
      .trim();
    // Preguntó cuándo es y lo que queda no lo dice: la bienvenida sí (día y hora).
    const day = event.startsAt ? new Intl.DateTimeFormat("es-CO", { timeZone: opts.timezone, day: "numeric" }).format(event.startsAt) : null;
    const missingWhen = ASKS_WHEN.test(foldForSearch(lastInbound.join(" "))) && Boolean(day) && !new RegExp(`\\b${day}\\b`).test(kept);
    return !ack && !missingWhen && kept.replace(/[^\p{L}\p{N}]/gu, "").length >= 20 ? kept : welcome();
  }
  if (!eventPassed(event, now) && ack && !saidBefore(lines, WELCOMED) && !WELCOMED.test(foldForSearch(reply))) return welcome();
  return null;
};

/** Lo que sale en vez de una respuesta que la metía en el embudo. */
export const guestWelcome = (
  event: GuestEvent,
  lines: Line[],
  opts: { firstName: string | null; timezone: string; now?: number }
): string => {
  const now = opts.now ?? Date.now();
  const name = opts.firstName ? `, ${opts.firstName}` : "";
  const door = saidBefore(lines, DOOR) ? "" : ` ${DOOR_LINE}`;
  if (eventPassed(event, now)) return `Con gusto${name}.${door} Te bendigo 🙏`;
  const day = event.startsAt
    ? ` el ${dayLabel(event.startsAt, opts.timezone)}${event.startsAtHasTime ? `, a las ${getTimeLabelInTz(event.startsAt, opts.timezone)} (hora de Colombia)` : ""}`
    : "";
  if (saidBefore(lines, WELCOMED)) return `Con gusto${name} 🙏 Te esperamos${day}.`;
  return `Con gusto${name}. Te damos la bienvenida: te esperamos en ${eventName(event)}${day}.${door} Te bendigo 🙏`;
};
