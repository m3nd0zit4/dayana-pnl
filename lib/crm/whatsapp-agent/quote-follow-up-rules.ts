import { getDateKeyInTz, zonedDateTimeToUtc } from "@/lib/datetime/zoned-time";

import { foldForSearch } from "../search-normalize";
import { isAutoSend } from "../whatsapp-attention-rules";
import { isPaymentInfo, paymentInfoKind } from "./chat-payment-link";

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
  /** Trae una foto, un audio o un documento. */
  media?: boolean;
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

/**
 * Cómo le cotizó Dayana (dueña, 22-oct: «no solo el link: también los datos de
 * Western Union, Bancolombia o cualquier otro»). Todos van al mismo
 * seguimiento; el tipo es para que Dayana y la IA sepan qué tiene en la mano.
 */
export type QuoteKind = "enlace" | "datos" | "enlace_y_datos" | "valor" | "comprobante";

export const QUOTE_KIND_LABEL: Record<QuoteKind, string> = {
  enlace: "Enlace de pago",
  datos: "Datos del banco",
  enlace_y_datos: "Enlace y datos del banco",
  valor: "Solo el valor",
  comprobante: "Le pidió el comprobante",
};

export type QuoteHow = {
  kind: QuoteKind;
  /** «Western Union», «Bancolombia», «Nequi»…; «Cuenta bancaria» si no dice cuál. */
  methods: string[];
  /** «paquete de 6 sesiones», del enlace o del texto. */
  pack: string | null;
  /** El valor tal cual lo escribió («175 USD», «$970.000 COP»). */
  amount: string | null;
};

export type QuoteSituation = {
  /** El último mensaje de Dayana con cómo pagar. */
  quoteAt: Date;
  /** Quién mandó ese último mensaje: Dayana o la asistente (los datos de `send_payment_info`). */
  quoteBy: "dayana" | "asistente";
  /** Cómo le cotizó (todos los mensajes de pago de los últimos días). */
  how: QuoteHow;
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
/** Lo mandó la asistente (o una propuesta suya que Dayana aprobó): no un envío automático ni un seguimiento. */
const byAssistant = (l: QuoteLine) => l.direction === "OUTBOUND" && (Boolean(l.isAutoReply) || l.source === "approval") && !isAutoSend(l) && !isFollowUp(l);

// --- Qué es una cotización y de qué tipo -----------------------------------

/**
 * ¿Este mensaje de Dayana es una cotización (cómo pagar su proceso)? Es
 * `isPaymentInfo`, que ya deja fuera el precio de un curso o un evento y el
 * de una sesión dicho antes de la llamada (Patricia, Montoya).
 */
export const isQuote = (text: string | null | undefined): boolean => isPaymentInfo(text);

/**
 * Un mensaje con la cotización: de Dayana (`isQuote`) o los datos para pagar
 * que mandó la asistente (`send_payment_info`, `send_payment_link`: dueña,
 * 22-oct, «cuando se envían datos de bancos»). De la asistente solo datos de
 * verdad: no «mándame el comprobante», ni el curso o la comunidad (no es su
 * proceso), ni sus seguimientos (sin datos: no se reinicia solo).
 */
export const isQuoteLine = (l: QuoteLine): boolean => (byDayana(l) && isQuote(l.body)) || (byAssistant(l) && assistantSentData(l.body));

/**
 * La asistente solo cuenta si va el bloque que pega el código: el enlace
 * (`send_payment_link`) o los datos de Ajustes con su número (`send_payment_info`;
 * el modelo nunca escribe un número de cuenta). «Cuando pagues por Nequi, me
 * mandas el comprobante» o «¿prefieres PayPal o Bancolombia?» no (revisión 22-oct).
 */
const assistantSentData = (body: string | null | undefined): boolean => {
  const text = body ?? "";
  if (paymentInfoKind(text) !== "data" || /\/pagar\/p\/course-|chat\.whatsapp\.com/i.test(text)) return false;
  // Una fecha («2026-10-26») no es un número de cuenta; un correo (PayPal, Zelle) o su enlace sí son datos.
  const noDates = text.replace(/\b\d{4}-\d{2}-\d{2}\b/g, "");
  return /\/pagar\/|paypal\.me|mpago\.la|[\w.+-]+@[\w-]+\.[a-z]{2,}/i.test(noDates) || /\d(?:[ .-]?\d){6,}/.test(noDates);
};

const METHODS: [string, RegExp][] = [
  ["Western Union", /\bwestern\b/],
  ["Bancolombia", /\bbancolombia\b/],
  ["Nequi", /\bnequi\b/],
  ["Daviplata", /\bdaviplata\b/],
  ["Davivienda", /\bdavivienda\b/],
  ["BBVA", /\bbbva\b/],
  ["Zelle", /\bzelle\b/],
  ["PayPal", /\bpaypal\b/],
  ["Yape", /\byape\b/],
  ["Plin", /\bplin\b/],
  ["Mercado Pago", /\bmercado ?pago\b/],
  ["CLABE / SPEI", /\b(clabe|spei)\b/],
  ["OXXO", /\boxxo\b/],
  ["Binance", /\bbinance\b/],
  ["Remitly", /\bremitly\b/],
  ["Global66", /\bglobal ?66\b/],
  ["MoneyGram", /\bmoneygram\b/],
];
const SMALL_PACK: Record<string, number> = { una: 1, un: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, doce: 12 };
// «310.583.3188» no es «310.583»: un grupo de miles no sigue con más cifras.
const AMOUNT =
  /\$\s?\d[\d.,]*(\s?(mil|cop|usd|mxn))?|\b\d{1,3}([.,]\d{3})+(?![.,]?\d)(\s?(mil|cop|usd|mxn|pesos|dolares|dólares))?|\b\d+([.,]\d+)?\s?(usd|cop|mxn|dolares|dólares|pesos)\b/gi;
/** Justo antes: una cédula, un teléfono, una cuenta (no el valor). */
const NOT_AMOUNT = /\b(cuenta|nequi|daviplata|clabe|telefono|celular|contacto|whatsapp|numero|id|c\.?c|nit|cedula|documento|identificacion)\b[^$\d]{0,12}$/;
const CURRENCY = /\$|\b(cop|usd|mxn|pesos|dolares|dólares|mil)\b/i;

/** El valor de un mensaje: el primero con moneda o $, si no el primero que no es una cédula o un teléfono. */
const amountIn = (body: string): string | null => {
  const flat = body.replace(/\s+/g, " ");
  const found = [...flat.matchAll(AMOUNT)].filter((m) => !NOT_AMOUNT.test(foldForSearch(flat.slice(0, m.index))));
  return (found.find((m) => CURRENCY.test(m[0])) ?? found[0])?.[0].trim() ?? null;
};

/** Cómo le cotizó, de sus mensajes de pago (en orden; lo más nuevo manda en el paquete y el valor). */
export const quoteHow = (bodies: string[]): QuoteHow => {
  let link = false;
  let data = false;
  const methods: string[] = [];
  let pack: string | null = null;
  let amount: string | null = null;
  for (const body of bodies) {
    const t = foldForSearch(body);
    const isLink = /\/pagar\//.test(t);
    link ||= isLink;
    if (paymentInfoKind(body) === "data") {
      // Un banco nombrado en un mensaje sin datos («la sesión vale 90 USD, por PayPal en la página») no es el medio.
      const named = METHODS.filter(([, re]) => re.test(t)).map(([name]) => name);
      if (!isLink || named.length) data = true;
      for (const name of named) if (!methods.includes(name)) methods.push(name);
    }
    const n = t.match(/\/pagar\/p\/therapy-(\d+)/)?.[1] ?? t.match(/\bpaquete de (\d{1,2}|una|un|dos|tres|cuatro|cinco|seis|doce) (sesion|sesiones)\b/)?.[1];
    const sessions = n ? (SMALL_PACK[n] ?? Number(n)) : NaN;
    if (sessions > 0) pack = sessions === 1 ? "1 sesión" : `paquete de ${sessions} sesiones`;
    amount = amountIn(body) ?? amount;
  }
  if (data && !methods.length) methods.push("Cuenta bancaria");
  const kind: QuoteKind = link && data ? "enlace_y_datos" : link ? "enlace" : data ? "datos" : amount ? "valor" : "comprobante";
  return { kind, methods: link ? ["Enlace de pago", ...methods] : methods, pack, amount };
};

/**
 * «Datos del banco: Western Union · paquete de 3 sesiones · 175 USD», para
 * Dayana (chat, campana). No va en el prompt: con «(Enlace de pago · 1 sesión)»
 * la IA escaló 3 de 3 a ENNY, que pedía la cuenta (eval 22-oct).
 */
export const quoteHowText = (how: QuoteHow): string => {
  const banks = how.methods.filter((m) => m !== "Enlace de pago");
  return [`${QUOTE_KIND_LABEL[how.kind]}${banks.length ? `: ${banks.join(", ")}` : ""}`, how.pack, how.amount]
    .filter(Boolean)
    .join(" · ");
};

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
  /\b(voy a (pagar|hacer el pago|transferir|enviar|mandar|depositar|empezar|iniciar|comenzar)|te (pago|transfiero|envio|mando|deposito|consigno|enviare|mandare|pagare|transferire)|(estoy|me siento) (muy )?decidid[oa]|si quiero (empezar|iniciar|comenzar|el proceso|hacerlo)|quiero (empezar|iniciar|comenzar)|apenas (me|tenga|reciba|cobre|llegue)|cuando (me paguen|cobre|me llegue|reciba|me depositen|pague|haga el pago|tenga el dinero|tenga la plata)|enviare el comprobante|empezamos|lo hago (el|la|este|esta|en)|hago el pago)\b/;
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
  if (/\b(la )?(otra|proxima|siguiente) seman(a|ita)\b|\bseman(a|ita) que viene\b/.test(t)) found.push(addDays(nextMonday, 4));
  if (/\besta semana\b/.test(t)) found.push(weekdayOf(today) >= 5 || weekdayOf(today) === 0 ? today : addDays(nextMonday, -3));
  if (/\b(a )?(fin|final|finales) de(l)? mes\b/.test(t)) {
    const last = lastDayOf(y, m);
    found.push(d >= last - 1 ? keyOf({ y, m: m + 1, d: lastDayOf(y, m + 1) }) : keyOf({ y, m, d: last }));
  }
  if (/\bquincena\b/.test(t)) found.push(d < 15 ? keyOf({ y, m, d: 15 }) : keyOf({ y, m, d: lastDayOf(y, m) }));
  // Solo el mes que viene: «si me hubiera coincidido inicios de mes» (Raquel) no es una fecha.
  if (/\b(el |del )?(proximo|otro|siguiente) mes\b|\bmes que viene\b/.test(t)) found.push(keyOf({ y, m: m + 1, d: 5 }));
  // «La primera semana de noviembre» (Carmen, 21-oct): el viernes de esa semana;
  // «a principios / mediados / finales de noviembre»: el 5, el 15, el último;
  // «en noviembre»: el 5. Un mes que ya pasó es el del año que viene.
  const REF = `(${MONTHS.join("|")}|(?:el |del )?(?:proximo|otro|siguiente) mes|mes que viene|mes)`;
  const monthRef = (w: string, next = false) => {
    const i = MONTHS.indexOf(w);
    if (i >= 0) return i + 1 < m ? { y: y + 1, m: i + 1 } : { y, m: i + 1 };
    return /proximo|otro|siguiente|que viene/.test(w) || next ? { y, m: m + 1 } : { y, m };
  };
  const dayOf = (r: { y: number; m: number }, day: number) => keyOf({ y: r.y, m: r.m, d: Math.min(day, lastDayOf(r.y, r.m)) });
  /** Ese día del mes que dice; «del mes» suelto, si ya pasó este mes, el del que viene. */
  const inMonth = (w: string, day: (r: { y: number; m: number }) => string) => {
    const k = day(monthRef(w));
    return w === "mes" && k < today ? day(monthRef(w, true)) : k;
  };
  for (const r of t.matchAll(new RegExp(`\\b(primera|primer|1ra|1era|segunda|2da) semana de(?:l)? ${REF}\\b`, "g"))) {
    const n = r[1] === "segunda" || r[1] === "2da" ? 2 : 1;
    found.push(
      inMonth(r[2], (ref) => {
        const first = dayOf(ref, 1);
        return addDays(first, ((5 - weekdayOf(first) + 7) % 7) + 7 * (n - 1));
      })
    );
  }
  for (const r of t.matchAll(new RegExp(`\\b(principios|inicios|comienzos|inicio|comienzo|mediados|finales|final|fin) de(?:l)? ${REF}\\b`, "g"))) {
    // «Inicios de mes» suelto no es una fecha (Raquel: «si me hubiera coincidido inicios de mes»); «fin de mes» va arriba.
    if (r[2] === "mes" && r[1] !== "mediados") continue;
    found.push(inMonth(r[2], (ref) => dayOf(ref, r[1] === "mediados" ? 15 : /^fin/.test(r[1]) ? lastDayOf(ref.y, ref.m) : 5)));
  }
  // Sin «desde»: «desde enero estoy sin trabajo» habla de lo que pasó.
  for (const r of t.matchAll(new RegExp(`\\b(en|para|hasta|a partir de) (?:el mes de )?(${MONTHS.join("|")})\\b`, "g"))) {
    found.push(dayOf(monthRef(r[2]), 5));
  }
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

/** «Te mande el comprobante cuando pague»: habla de lo que va a hacer, no de lo que hizo. */
const FUTURE = /\b(cuando|apenas|en cuanto|tan pronto|despues que|luego que)\b/;
/** Habla de pagar o de mandar el pago («pago el viernes», «lo transfiero»). */
const PAY_WORD = /\b(pag|envi|mand|transfer|deposit|consign)\w*/;
/**
 * Queda en una fecha para empezar, en primera persona: «ya quedamos para la
 * primer semana de noviembre» (Carmen). No «quedamos así», «empiezo a
 * trabajar», «mi hija empieza el colegio» (revisión 22-oct).
 */
const START_ON = new RegExp(
  `\\b(quedamos (para|en) (el|la|los|las|esta|este|\\d)|(empiezo|inicio|comienzo|arranco|empezamos|iniciamos|comenzamos) ` +
    // «empiezo el lunes», «inicio la otra semana», «comienzo en noviembre», «empiezo el proceso»; no «inicio el trabajo nuevo», «inicio la quimio».
    `(el (${WEEKDAYS.join("|")}|\\d+)|la (otra|proxima|siguiente|primera|segunda) semana|la semana que viene|en (\\d+|${MONTHS.join("|")})|a partir del?|(el|la|mi) (proceso|terapia|terapias|sesion|sesiones|tratamiento)))\\b`
);

/**
 * El estado que dice un mensaje suyo (null: no dice nada de pagar, «gracias»,
 * «ok»). Con «no me alcanza» o «lo pienso», solo una fecha de dentro de 2
 * días o más la vuelve «va a pagar»: «hoy no tengo plata» y «te aviso mañana»
 * no son una promesa de pago (revisión 22-oct).
 */
export const stateFromReply = (text: string, at: Date, tz: string): { state: QuoteState; payBy: Date | null } | null => {
  const t = foldForSearch(text);
  if (!t.trim()) return null;
  if (PAID.test(t) && !FUTURE.test(t)) return { state: "pago_enviado", payBy: null };
  const payBy = payDateFrom(t, at, tz);
  const inDays = payBy ? Math.round((payBy.getTime() - zonedDateTimeToUtc(getDateKeyInTz(at, tz), "00:00", tz).getTime()) / DAY) : null;
  // Un «no» sin hablar de pagar es un no, aunque traiga una fecha («ya no quiero
  // iniciar, quizás en diciembre», «no me interesa, el lunes empiezo a trabajar»).
  if (NO.test(t) && !PAY_WORD.test(t)) return { state: "no_quiere", payBy: null };
  // «No gracias por el recordatorio, pago el viernes»: una fecha para pagar gana al «no gracias».
  if (payBy && (PAY.test(t) || PAY_WORD.test(t) || START_ON.test(t))) return { state: "pagara", payBy };
  if (NO.test(t)) return { state: "no_quiere", payBy: null };
  // «No me alcanza ahora, pero a fin de mes sí»: con una fecha (2 días o más), va a pagar.
  if (payBy && inDays !== null && inDays >= 2 && (MONEY.test(t) || THINK.test(t))) return { state: "pagara", payBy };
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
  const since = opts.now.getTime() - opts.lookbackDays * DAY;
  // La última cotización de Dayana manda: si vuelve a mandar cómo pagar, empieza de nuevo.
  let qi = -1;
  for (let i = real.length - 1; i >= 0; i--) {
    if (byDayana(real[i]) && isQuote(real[i].body)) {
      qi = i;
      break;
    }
  }
  // Sin ninguna de Dayana: la PRIMERA de la asistente. Lo que la asistente manda
  // después (reenviar el enlace, los datos) no reinicia nada: ni borra lo que
  // ella dijo ni los seguimientos ya enviados, ni revive una cotización de
  // Dayana que ya pasó los `lookbackDays` (revisión 22-oct).
  if (qi < 0) qi = real.findIndex((l) => l.sentAt.getTime() >= since && isQuoteLine(l));
  if (qi < 0) return null;
  const quoteAt = real[qi].sentAt;
  if (quoteAt.getTime() < since) return null;
  // El tipo, de todo lo que le mandaron estos días (también lo que la asistente mandó después).
  const how = quoteHow(real.filter((l) => l.sentAt.getTime() >= since && isQuoteLine(l)).map((l) => l.body!));
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
      // Una foto o un PDF sin texto (puede ser el comprobante) también es una respuesta.
      if (!l.body?.trim()) {
        if (l.media) lastPersonAt = l.sentAt;
        continue;
      }
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
  const last = [...real].reverse().find((l) => l.body?.trim() || l.media);
  // Un «Gracias 😊» o «Igualmente» al final no espera respuesta; una pregunta, algo largo o una foto sí.
  const lastText = last?.body?.replace(/^🎤\s*/, "").trim() ?? "";
  const ackOnly = Boolean(lastText) && !/[?¿]/.test(lastText) && lastText.split(/\s+/).length <= 6;
  return {
    quoteAt,
    quoteBy: byDayana(real[qi]) ? "dayana" : "asistente",
    how,
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
    // Contestó después del 1º: el 2º igual espera `secondAfterDays` desde el 1º (revisión 22-oct).
    if (s.lastSentAt) at = new Date(Math.max(at.getTime(), s.lastSentAt.getTime() + config.secondAfterDays * DAY));
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
 * mensaje suyo sin contestar (eso lo contesta la IA), ella no escribió en las
 * últimas 2 h (la IA puede estar contestándole) y nadie le escribió en las
 * últimas 24 h.
 */
export const followUpDue = (
  s: QuoteSituation,
  config: QuoteFollowUpConfig,
  opts: { now: Date; tz: string; lastOutboundAt: Date | null }
): { kind: "first" | "second" } | null => {
  const next = nextFollowUp(s, config, opts.tz);
  if (!next || next.at > opts.now) return null;
  if (s.awaitingReply) return null;
  if (s.lastPersonAt && opts.now.getTime() - s.lastPersonAt.getTime() < 2 * 3600_000) return null;
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
/**
 * `pack`: el paquete que le corresponde según las notas de Dayana (Joselyn:
 * le mandó 3 y 6 sesiones y la nota dice que primero el de 3); si no, el de la
 * cotización.
 */
export const quotePromptLine = (s: QuoteSituation, tz: string, pack: string | null = s.how.pack): string =>
  [
    `SEGUIMIENTO DEL CIERRE: ${s.quoteBy === "dayana" ? "Dayana le mandó" : "Ya le mandaste"} cómo pagar el ${dayLabel(s.quoteAt, tz)}. Ahora: ${quoteStateText(s, tz)}${s.said ? `; dijo: «${s.said.slice(0, 160)}»` : ""}.`,
    "- Si dice cuándo va a pagar, que está decidida o que espera un dinero: no escales. Dile con calidez que Dayana queda muy atenta y que, cuando haga el pago, te mande el comprobante por aquí para que Dayana le agende el inicio.",
    // ENNY (23-oct): «pon la fecha y el día y me envías la forma de pago» al seguimiento.
    `- Si pide el enlace, los datos o la forma de pago, o no recuerda qué le mandó Dayana: empieza recordándole en qué quedó${pack ? ` («Recuerda que con Dayana quedaron en ${packPhrase(pack)}»)` : ""} y vuelve a mandárselo con send_payment_link o send_payment_info, sin escribir a mano una cuenta ni un enlace. El día y la hora de inicio los agenda Dayana cuando reciba el comprobante: no escales por eso.`,
    "- Si dice que lo está pensando: respétalo y ofrécele resolver dudas, sin presionar.",
    "- Si dice que no le alcanza: mira COMUNIDAD Y OPCIONES MÁS ECONÓMICAS. Si dice que ya pagó o manda el comprobante: register_payment_receipt.",
  ].join("\n");

/** «1 sesión» → «una sesión»; «paquete de 6 sesiones» → «el paquete de 6 sesiones». */
const packPhrase = (pack: string) => (pack === "1 sesión" ? "una sesión" : `el ${pack}`);

const COMPROBANTE = "Cuando hagas el pago, me mandas el comprobante por aquí y Dayana te agenda el día y la hora para iniciar.";

/**
 * Pidió cómo pagar después de la cotización y la respuesta lleva el enlace o
 * los datos, pero no le recuerda en qué quedó con Dayana ni le pide el
 * comprobante (dueña, 23-oct: «Recuerda que habían quedado en este paquete»;
 * en la evaluación el modelo no lo dijo ninguna de 3 veces): se agrega después
 * de la primera frase («Claro, Enny.») o, si solo hay una, al principio.
 */
export const withQuoteReminder = (text: string, pack: string | null): string => {
  let out = text.trim();
  const t = foldForSearch(out);
  if (pack && !t.includes("quedaron en") && !t.includes(foldForSearch(packPhrase(pack)))) {
    const reminder = `Recuerda que con Dayana quedaron en ${packPhrase(pack)}.`;
    const first = out.match(/^[^.!?\n]{1,200}[.!?][ \t]+(?=\S)/)?.[0];
    out = first ? `${first}${reminder} ${out.slice(first.length)}` : `${reminder} ${out}`;
  }
  if (!/\bcomprobante\b/.test(t)) {
    const body = out.replace(/[\s:]+$/, "");
    out = `${body}${/[.!?]$/.test(body) ? "" : "."} ${COMPROBANTE}`;
  }
  return out;
};

/**
 * Pide cómo pagar: el enlace, los datos, la forma de pago, «¿cómo te pago?»
 * («me emvias la forma de pago», ENNY). No el enlace de otra cosa (el Meet, la
 * clase, el grupo), ni lo que tiene que ver Dayana: un enlace que no abre, una
 * factura, cuotas, un descuento, otra moneda u otro medio, ni «ya pagué» (revisión 23-oct).
 */
const ASKS_HOW_TO_PAY =
  /\b(forma|formas|medio|medios|metodo|metodos|datos|link|enlace|informacion) (de|del|para el|para) pago\b|\b(link|enlace) (para|de) pagar\b|\b(los|tus|sus) datos\b|\bnumero de cuenta\b|\bcomo (te |le )?(pago|puedo pagar|hago el pago|realizo el pago|hago la transferencia)\b|\b(enviame|envieme|emviame|mandame|mandeme|pasame|paseme|regalame|me envias|me emvias|me envia|me mandas|me manda|me pasas|me pasa|me das|me da)\b[^.?!\n]{0,30}\b(pago|pagar|link|enlace|datos|cuenta)\b/;
const NOT_JUST_PAY =
  /\b(no (me )?(abre|funciona|sirve|deja|carga|sale|aparece|acepta)|error|rechaz\w*|fall\w*|factura|recibo|cuotas?|descuento|rebaja|dolares|usd|euros|otra forma|otro medio|otra manera|otro banco|otra cuenta|ya (te )?(pague|transferi|deposite|consigne|envie|mande|hice))\b/;
const OTHER_LINK = /\b(meet|zoom|clase|grupo|comunidad|webinar|curso|taller|evento|reunion|llamada|live|directo|video|sesion de (hoy|manana))\b/;
export const asksHowToPay = (texts: string[]): boolean => {
  const t = foldForSearch(texts.join(" "));
  if (!ASKS_HOW_TO_PAY.test(t) || NOT_JUST_PAY.test(t)) return false;
  return !OTHER_LINK.test(t) || /\b(de pago|para pagar)\b/.test(t);
};

/**
 * Lo que recibe quien pide cómo pagar después de la cotización si el modelo
 * escaló igual (ENNY, 23-oct: «Déjame confirmarlo con Dayana»): en qué quedó
 * con Dayana y, debajo, su enlace o los datos (los pega el código).
 */
export const quotePayReply = (opts: { name: string | null; pack: string | null; what: "link" | "data" | "dayana_data" }): string => {
  return [
    `Claro${opts.name ? `, ${opts.name}` : ""}.`,
    opts.pack ? `Recuerda que con Dayana quedaron en ${packPhrase(opts.pack)}.` : "Recuerda que Dayana ya te envió cómo hacer el pago.",
    COMPROBANTE,
    opts.what === "link" ? "Aquí tienes el enlace de pago" : opts.what === "data" ? "Aquí tienes los datos para el pago" : "Puedes hacer el pago con los datos que te envió Dayana.",
  ].join(" ");
};
