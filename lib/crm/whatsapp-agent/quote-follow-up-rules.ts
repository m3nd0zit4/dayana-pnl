import { getDateKeyInTz, zonedDateTimeToUtc } from "@/lib/datetime/zoned-time";

import { foldForSearch } from "../search-normalize";
import { isAutoSend } from "../whatsapp-attention-rules";
import { isPaymentInfo } from "./chat-payment-link";

/**
 * El seguimiento del cierre (pedido de la dueña, 22-oct): después de la
 * llamada gratis Dayana le manda a la persona cómo pagar (el enlace, la
 * cuenta, el valor: la «cotización») y muchas no vuelven a escribir. Dayana
 * le hizo a Raquel un audio de seguimiento («quedo súper atenta para iniciar
 * con tu proceso… tan pronto me envíes el comprobante iniciamos») y Raquel
 * contestó que paga la otra semana, a fin de mes. Eso lo hace ahora la
 * asistente sola, en orden:
 *
 * 1. En qué punto está cada persona después de la cotización
 *    (`quoteSituation`): cotizada sin respuesta, va a pagar (y cuándo: «la
 *    otra semana», «fin de mes», «el viernes»), lo está pensando, sin dinero
 *    por ahora, no quiere seguir, dice que ya pagó.
 * 2. Cuándo le toca el siguiente mensaje (`nextFollowUp`): 2 días después de
 *    la cotización si no respondió; si dijo una fecha, el día siguiente; el
 *    2º, 4 días después del 1º. Dos como mucho por cotización (dueña: «2
 *    seguimientos»). Si Dayana le escribe, espera; si Dayana le vuelve a mandar
 *    cómo pagar, empieza de nuevo desde ahí.
 * 3. El texto, en la voz de la asistente y con lo que dijo la persona
 *    (`followUpText`).
 *
 * Nada se guarda aparte: todo sale del chat (la cotización es el último
 * mensaje de Dayana con cómo pagar, y los seguimientos ya enviados llevan
 * `source` `recordatorio:cotizacion:…`). El envío está en `quote-follow-up.ts`.
 *
 * Puro: lo usan el envío, el prompt (`brain.ts`), el chat del CRM y las pruebas.
 */

export type QuoteLine = {
  direction: "INBOUND" | "OUTBOUND";
  body: string | null;
  sentAt: Date;
  isAutoReply?: boolean;
  source?: string | null;
  clientKey?: string | null;
  kind?: string | null;
};

export type QuoteState = "cotizada" | "pagara" | "lo_piensa" | "sin_dinero" | "no_quiere" | "pago_enviado";

export const QUOTE_STATE_LABEL: Record<QuoteState, string> = {
  cotizada: "Cotizada, sin respuesta",
  pagara: "Va a pagar",
  lo_piensa: "Lo está pensando",
  sin_dinero: "Sin dinero por ahora",
  no_quiere: "No quiere seguir",
  pago_enviado: "Dice que ya pagó",
};

/** El `source` de los seguimientos: empieza por `recordatorio:` (sale solo, no es una respuesta). */
export const QUOTE_FOLLOW_UP_SOURCE = "recordatorio:cotizacion:";

export type QuoteFollowUpConfig = {
  /** Días después de la cotización para el 1º si no respondió. */
  firstAfterDays: number;
  /** Días después del 1º para el 2º, si no respondió. */
  secondAfterDays: number;
  /** Cuántos como mucho por cotización. */
  max: number;
  /** Solo cotizaciones de estos últimos días. */
  lookbackDays: number;
};

export type QuoteSituation = {
  /** El último mensaje de Dayana con cómo pagar. */
  quoteAt: Date;
  state: QuoteState;
  /** Cuándo dijo que paga (medianoche de ese día en su zona), si lo dijo. */
  payBy: Date | null;
  /** Lo que dijo, tal cual (para Dayana y el prompt). */
  said: string | null;
  /** Cuándo dijo lo que decide el estado (o la cotización, si no dijo nada). */
  saidAt: Date;
  /** Seguimientos ya enviados para esta cotización. */
  sent: number;
  lastSentAt: Date | null;
  /** Su último mensaje después de la cotización. */
  lastPersonAt: Date | null;
  /** Lo último que Dayana escribió ella misma (después de la cotización). */
  dayanaLastAt: Date;
  /** Lo último del chat es suyo, nadie le contestó y espera respuesta (no un «gracias»). */
  awaitingReply: boolean;
};

const DAY = 24 * 3600_000;

/** Lo escribió Dayana ella misma: no la IA, ni un envío automático, ni una propuesta aprobada. */
const byDayana = (l: QuoteLine) => l.direction === "OUTBOUND" && !l.isAutoReply && l.source !== "approval" && !isAutoSend(l);
const isFollowUp = (l: QuoteLine) => l.direction === "OUTBOUND" && Boolean(l.source?.startsWith(QUOTE_FOLLOW_UP_SOURCE));

// --- Lo que dijo después de la cotización ---------------------------------

/** «Ya pagué», «te mandé el comprobante», «ya hice la transferencia». */
const PAID =
  /\b(ya (te )?(pague|transferi|deposite|consigne|envie|mande|hice (el|la) (pago|transferencia|deposito|consignacion|envio))|te (envie|mande|adjunto) el comprobante|ahi (va|esta|te va) el comprobante|ya quedo (el|hecho el) pago|listo el pago)\b/;
/** «No me interesa», «ya no quiero», «prefiero no». */
const NO =
  /\b(no me interesa|ya no (quiero|me interesa|voy a (seguir|tomar|hacer))|no (voy|puedo) a? ?(tomar|hacer|seguir|continuar) (el|con el|la|las|los) (proceso|terapia|sesion)|no gracias|prefiero no|lo dejo (asi|por ahora|para despues)|no estoy interesad[oa])\b/;
/** «No me alcanza», «no tengo el dinero», «estoy ahorrando». */
const MONEY =
  /\b(no me alcanza|no tengo (el |la |los |con que |como |para )?(dinero|plata|recursos|pagar|platica)|no cuento con (el )?(dinero|plata|recursos)|estoy (corta|corto|apretad[oa]|sin (dinero|plata|trabajo))|ahorr\w+|no (puedo|podre|voy a poder) pagar|mal de (plata|dinero)|economicamente)\b/;
/** «Voy a pagar», «te envío», «estoy decidida», «apenas me paguen». */
const PAY =
  /\b(voy a (pagar|hacer el pago|transferir|enviar|mandar|depositar|empezar|iniciar|comenzar)|te (pago|transfiero|envio|mando|deposito|consigno|enviare|mandare|pagare|transferire)|(estoy|me siento) (muy )?decidid[oa]|si quiero (empezar|iniciar|comenzar|el proceso|hacerlo)|quiero (empezar|iniciar|comenzar)|apenas (me|tenga|reciba|cobre|llegue)|cuando (me paguen|cobre|me llegue|reciba|me depositen)|enviare el comprobante|empezamos|lo hago (el|la|este|esta|en)|hago el pago)\b/;
/** «Lo voy a pensar», «te aviso», «lo hablo con mi esposo». */
const THINK =
  /\b(lo (voy a )?pens\w+|(te|le) (aviso|confirmo)\b|lo (consulto|hablo|comento|converso)|(dejame|dame) (ver|pensar\w*|unos dias|un tiempo)|tengo que (ver|pensarlo|hablarlo|consultarlo|organizarme)|estamos en contacto|despues te (digo|escribo|aviso|confirmo))/;

// --- Cuándo dijo que paga -------------------------------------------------

const WEEKDAYS = ["domingo", "lunes", "martes", "miercoles", "jueves", "viernes", "sabado"];
const MONTHS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const SMALL: Record<string, number> = { un: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, diez: 10, quince: 15 };

type Ymd = { y: number; m: number; d: number };
const ymdOf = (key: string): Ymd => {
  const [y, m, d] = key.split("-").map(Number);
  return { y, m, d };
};
const keyOf = ({ y, m, d }: Ymd) => {
  const t = new Date(Date.UTC(y, m - 1, d));
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}-${String(t.getUTCDate()).padStart(2, "0")}`;
};
const addDays = (key: string, n: number) => {
  const { y, m, d } = ymdOf(key);
  return keyOf({ y, m, d: d + n });
};
const weekdayOf = (key: string) => new Date(`${key}T12:00:00Z`).getUTCDay();
const lastDayOf = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

/**
 * El día que dijo que paga, contado desde el día en que lo escribió (en su
 * zona): «mañana», «el viernes», «la otra semana» (el viernes de la semana
 * siguiente), «fin de mes», «la quincena», «principios del otro mes» (el 5),
 * «en 3 días», «el 30», «el 2 de noviembre». Si dice varias, la más lejana
 * (Raquel: «la otra semana, que es fin de mes»). Nada a más de 60 días.
 */
export const payDateFrom = (text: string, at: Date, tz: string): Date | null => {
  const t = foldForSearch(text);
  const today = getDateKeyInTz(at, tz);
  const { y, m, d } = ymdOf(today);
  const found: string[] = [];
  if (/\bpasado manana\b/.test(t)) found.push(addDays(today, 2));
  else if (/(?<!(en|por|de|esta) (la )?)\bmanana\b/.test(t)) found.push(addDays(today, 1));
  if (/\bhoy\b/.test(t)) found.push(today);
  for (const [i, name] of WEEKDAYS.entries()) {
    if (!new RegExp(`\\b(el|este|esta|para el|hasta el|el proximo|el otro) ${name}\\b`).test(t)) continue;
    const ahead = (i - weekdayOf(today) + 7) % 7 || 7;
    found.push(addDays(today, ahead));
  }
  const nextMonday = addDays(today, ((1 - weekdayOf(today) + 7) % 7) || 7);
  if (/\b(la )?(otra|proxima|siguiente) semana\b|\bsemana que viene\b/.test(t)) found.push(addDays(nextMonday, 4));
  if (/\besta semana\b/.test(t)) found.push(weekdayOf(today) >= 5 || weekdayOf(today) === 0 ? today : addDays(nextMonday, -3));
  if (/\b(a )?(fin|final|finales) de(l)? mes\b/.test(t)) {
    const last = lastDayOf(y, m);
    found.push(d >= last - 1 ? keyOf({ y, m: m + 1, d: lastDayOf(y, m + 1) }) : keyOf({ y, m, d: last }));
  }
  if (/\bquincena\b/.test(t)) found.push(d < 15 ? keyOf({ y, m, d: 15 }) : keyOf({ y, m, d: lastDayOf(y, m) }));
  // Solo el mes que viene: «si me hubiera coincidido inicios de mes» (Raquel) no es una fecha.
  if (/\b(el |del )?(proximo|otro|siguiente) mes\b|\bmes que viene\b/.test(t)) found.push(keyOf({ y, m: m + 1, d: 5 }));
  for (const r of t.matchAll(/\ben (\d{1,2}|un|una|dos|tres|cuatro|cinco|seis|siete|ocho|diez|quince) (dias?|semanas?)\b/g)) {
    const n = SMALL[r[1]] ?? Number(r[1]);
    found.push(addDays(today, r[2].startsWith("semana") ? n * 7 : n));
  }
  for (const r of t.matchAll(new RegExp(`\\b(el|para el|hasta el) (dia )?(\\d{1,2})( de (${MONTHS.join("|")}))?\\b`, "g"))) {
    const day = Number(r[3]);
    if (day < 1 || day > 31) continue;
    const month = r[5] ? MONTHS.indexOf(r[5]) + 1 : day >= d ? m : m + 1;
    const year = r[5] && month < m ? y + 1 : y;
    found.push(keyOf({ y: year, m: month, d: Math.min(day, lastDayOf(year, month)) }));
  }
  const limit = addDays(today, 60);
  // «Hoy» junto a otra fecha («lo hubiera comenzado hoy, pero…») no es la fecha.
  const ahead = found.filter((k) => k > today && k <= limit);
  const best = ahead.length ? ahead.sort().at(-1) : found.includes(today) ? today : null;
  return best ? zonedDateTimeToUtc(best, "00:00", tz) : null;
};

/** El estado que dice un mensaje suyo (null: no dice nada de pagar, «gracias», «ok»). */
export const stateFromReply = (text: string, at: Date, tz: string): { state: QuoteState; payBy: Date | null } | null => {
  const t = foldForSearch(text);
  if (!t.trim()) return null;
  if (PAID.test(t)) return { state: "pago_enviado", payBy: null };
  if (NO.test(t)) return { state: "no_quiere", payBy: null };
  const payBy = payDateFrom(t, at, tz);
  // «No me alcanza ahora, pero a fin de mes sí»: con una fecha, va a pagar.
  if (payBy && (PAY.test(t) || MONEY.test(t) || THINK.test(t))) return { state: "pagara", payBy };
  if (MONEY.test(t)) return { state: "sin_dinero", payBy: null };
  if (PAY.test(t)) return { state: "pagara", payBy };
  if (THINK.test(t)) return { state: "lo_piensa", payBy: null };
  return null;
};

/**
 * En qué punto está después de la última cotización de Dayana (en las líneas
 * que se le pasan; más vieja que `lookbackDays`, no cuenta). Null si Dayana no
 * le mandó cómo pagar.
 */
export const quoteSituation = (
  lines: QuoteLine[],
  opts: { now: Date; tz: string; lookbackDays: number }
): QuoteSituation | null => {
  const real = lines.filter((l) => l.kind !== "system");
  let qi = -1;
  for (let i = real.length - 1; i >= 0; i--) {
    if (byDayana(real[i]) && isPaymentInfo(real[i].body)) {
      qi = i;
      break;
    }
  }
  if (qi < 0) return null;
  const quoteAt = real[qi].sentAt;
  if (quoteAt.getTime() < opts.now.getTime() - opts.lookbackDays * DAY) return null;
  const after = real.slice(qi + 1);
  let state: QuoteState = "cotizada";
  let payBy: Date | null = null;
  let said: string | null = null;
  let saidAt = quoteAt;
  let lastPersonAt: Date | null = null;
  let dayanaLastAt = quoteAt;
  const followUps = after.filter(isFollowUp);
  for (const l of after) {
    if (l.direction === "INBOUND") {
      if (!l.body?.trim()) continue;
      lastPersonAt = l.sentAt;
      const s = stateFromReply(l.body, l.sentAt, opts.tz);
      if (s) {
        state = s.state;
        payBy = s.payBy;
        said = l.body.replace(/^🎤\s*/, "").trim().slice(0, 200);
        saidAt = l.sentAt;
      }
    } else if (byDayana(l) && l.body?.trim()) {
      dayanaLastAt = l.sentAt;
    }
  }
  const last = [...real].reverse().find((l) => l.body?.trim());
  // Un «Gracias 😊» o «Igualmente» al final no espera respuesta; una pregunta o algo largo sí.
  const lastText = last?.body?.replace(/^🎤\s*/, "").trim() ?? "";
  const ackOnly = !/[?¿]/.test(lastText) && lastText.split(/\s+/).length <= 6;
  return {
    quoteAt,
    state,
    payBy,
    said,
    saidAt,
    sent: followUps.length,
    lastSentAt: followUps.at(-1)?.sentAt ?? null,
    lastPersonAt,
    dayanaLastAt,
    awaitingReply: last?.direction === "INBOUND" && !ackOnly,
  };
};

/** El día siguiente a `d` (en su zona), a las 10:00 a. m. */
const dayAfterAt10 = (d: Date, tz: string) => zonedDateTimeToUtc(addDays(getDateKeyInTz(d, tz), 1), "10:00", tz);

/**
 * Cuándo le toca el siguiente seguimiento (null: ya no). `kind`: el 1º o el
 * 2º (el texto cambia). Respeta a Dayana: si ella escribió, dos días desde
 * ese mensaje.
 */
export const nextFollowUp = (
  s: QuoteSituation,
  config: QuoteFollowUpConfig,
  tz: string
): { at: Date; kind: "first" | "second" } | null => {
  if (s.state === "no_quiere" || s.state === "pago_enviado") return null;
  if (s.sent >= config.max) return null;
  const repliedSinceLast = Boolean(s.lastPersonAt && (!s.lastSentAt || s.lastPersonAt > s.lastSentAt));
  const kind: "first" | "second" = s.sent === 0 ? "first" : "second";
  let at: Date;
  if (s.sent > 0 && !repliedSinceLast) {
    // No contestó al anterior: el siguiente a los `secondAfterDays`.
    at = new Date(s.lastSentAt!.getTime() + config.secondAfterDays * DAY);
    if (s.state === "pagara" && s.payBy) at = new Date(Math.max(at.getTime(), dayAfterAt10(s.payBy, tz).getTime()));
  } else {
    switch (s.state) {
      case "cotizada":
        at = new Date(Math.max(s.quoteAt.getTime(), s.lastPersonAt?.getTime() ?? 0) + config.firstAfterDays * DAY);
        break;
      case "pagara":
        at = s.payBy ? dayAfterAt10(s.payBy, tz) : new Date(s.saidAt.getTime() + 3 * DAY);
        break;
      case "lo_piensa":
        at = new Date(s.saidAt.getTime() + 3 * DAY);
        break;
      case "sin_dinero":
        at = new Date(s.saidAt.getTime() + 7 * DAY);
        break;
    }
  }
  // Dayana le escribió ella misma: le da dos días.
  if (s.dayanaLastAt > s.quoteAt) at = new Date(Math.max(at.getTime(), s.dayanaLastAt.getTime() + 2 * DAY));
  return { at, kind };
};

/** Solo de 9:00 a. m. a 7:00 p. m. en su zona. */
export const inSendingHours = (now: Date, tz: string): boolean => {
  const h = Number(new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", hourCycle: "h23" }).format(now));
  return h >= 9 && h < 19;
};

/**
 * ¿Sale ahora? Le toca, es de día en su zona, lo último del chat no es un
 * mensaje suyo sin contestar (eso lo contesta la IA) y nadie le escribió en
 * las últimas 24 h.
 */
export const followUpDue = (
  s: QuoteSituation,
  config: QuoteFollowUpConfig,
  opts: { now: Date; tz: string; lastOutboundAt: Date | null }
): { kind: "first" | "second" } | null => {
  const next = nextFollowUp(s, config, opts.tz);
  if (!next || next.at > opts.now) return null;
  if (s.awaitingReply) return null;
  if (opts.lastOutboundAt && opts.now.getTime() - opts.lastOutboundAt.getTime() < DAY) return null;
  if (!inSendingHours(opts.now, opts.tz)) return null;
  return { kind: next.kind };
};

/**
 * El texto (dentro de las 24 h; fuera va la plantilla `seguimiento_proceso`).
 * En la voz de la asistente, como el audio de Dayana a Raquel: queda atenta
 * para iniciar, «tan pronto envíes el comprobante». Sin precios.
 */
export const followUpText = (kind: "first" | "second", state: QuoteState, name: string | null): string => {
  const hola = name ? `Hola ${name}, te bendigo 🙏` : "Hola, te bendigo 🙏";
  if (kind === "second") {
    return `${name ? `Hola ${name} 🙏` : "Hola 🙏"} Te escribo de parte de Dayana: sigue con un espacio para ti para iniciar tu proceso. Si tienes alguna dificultad con el pago, cuéntame y lo vemos por aquí.`;
  }
  switch (state) {
    case "pagara":
      return `${hola} ¿Cómo vas con el pago? Dayana queda muy atenta para iniciar tu proceso. Cuando lo hagas, me mandas el comprobante por aquí y Dayana te agenda.`;
    case "lo_piensa":
      return `${hola} ¿Pudiste pensarlo? Dayana queda muy atenta para iniciar tu proceso personalizado. Si tienes alguna duda, con gusto te ayudo por aquí.`;
    case "sin_dinero":
      return `${hola} ¿Cómo has estado? Dayana queda atenta para cuando quieras iniciar tu proceso. Si tienes alguna dificultad con el pago, cuéntame y lo vemos.`;
    default:
      return `${hola} Dayana queda muy atenta para iniciar tu proceso personalizado. ¿Cuándo te gustaría empezar? Tan pronto envíes el comprobante de pago por aquí, Dayana te agenda.`;
  }
};

const dayLabel = (d: Date, tz: string) =>
  new Intl.DateTimeFormat("es-CO", { timeZone: tz, weekday: "long", day: "numeric", month: "long" }).format(d);

/** «Va a pagar (dijo «la otra semana», ≈ viernes, 31 de octubre)», para Dayana y la IA. */
export const quoteStateText = (s: QuoteSituation, tz: string): string =>
  `${QUOTE_STATE_LABEL[s.state]}${s.payBy ? ` (≈ ${dayLabel(s.payBy, tz)})` : ""}`;

/**
 * La línea del prompt (solo a quien Dayana ya le mandó cómo pagar): en qué va
 * y qué hacer si dice cuándo paga, que lo piensa o que no le alcanza. Antes,
 * a «estoy decidida, pago la otra semana» (Raquel, 22-oct) el modelo no supo
 * qué decir y salió «Déjame consultarlo con Dayana».
 */
export const quotePromptLine = (s: QuoteSituation, tz: string): string =>
  [
    `SEGUIMIENTO DEL CIERRE: Dayana le mandó cómo pagar el ${dayLabel(s.quoteAt, tz)}. Ahora: ${quoteStateText(s, tz)}${s.said ? `; dijo: «${s.said.slice(0, 160)}»` : ""}.`,
    "- Si dice cuándo va a pagar, que está decidida o que espera un dinero: no escales. Dile con calidez que Dayana queda muy atenta y que, cuando haga el pago, te mande el comprobante por aquí para que Dayana le agende el inicio.",
    "- Si dice que lo está pensando: respétalo y ofrécele resolver dudas, sin presionar.",
    "- Si dice que no le alcanza: mira COMUNIDAD Y OPCIONES MÁS ECONÓMICAS. Si dice que ya pagó o manda el comprobante: register_payment_receipt.",
  ].join("\n");
