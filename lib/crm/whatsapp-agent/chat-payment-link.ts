import { foldForSearch } from "../search-normalize";
import { isAutoSend } from "../whatsapp-attention-rules";

/**
 * El enlace de pago que Dayana ya mandó en el chat (Paola, 21-oct-2026):
 * después de la llamada gratis Dayana le mandó desde el celular «te voy a
 * enviar el link de pago» y `/pagar/p/therapy-24`. La asistente preguntó
 * «¿pudiste hablar con Dayana?», Paola dijo «Si» y la asistente le mandó los
 * datos de Bancolombia: `send_payment_link` solo conocía los enlaces creados
 * en el CRM y, sin uno, la regla decía «manda las cuentas».
 *
 * Regla de la dueña: si Dayana ya le mandó un enlace de pago, la asistente le
 * dice que pague por ese enlace; los datos de la cuenta solo si la persona los
 * pide (la cuenta, transferir, Nequi, Western Union…) o el enlace no le sirve.
 *
 * Puro: qué enlace mandó Dayana y si la persona pide los datos de la cuenta.
 */

type Line = {
  direction: "INBOUND" | "OUTBOUND";
  body: string | null;
  isAutoReply?: boolean;
  source?: string | null;
  clientKey?: string | null;
  sentAt?: Date;
};

/** Lo escribió Dayana ella misma: no la IA, ni un masivo (`bulk:`), ni una propuesta aprobada. */
const byDayana = (l: Line) => l.direction === "OUTBOUND" && !l.isAutoReply && l.source !== "approval" && !isAutoSend(l);

/** `https://www.dayanabeltran.com/pagar/p/therapy-24`, `…/pagar/<token>`. */
const PAY_URL = /https?:\/\/[^\s<>"')\]]+\/pagar\/[^\s<>"')\]]+/gi;
/**
 * El enlace de pago de un taller (`/pagar/p/taller-<slug>`, dueña 25-oct: la
 * asistente lo manda a quien quiere separar su cupo). No es cómo pagar su
 * proceso: no dice que ya tuvo la llamada, no es una cotización y no es «el
 * enlace que te mandó Dayana».
 */
const WORKSHOP_PAY = /\S*\/pagar\/p\/taller-\S*/gi;
const withoutWorkshopLinks = (text: string) => text.replace(WORKSHOP_PAY, " ");
const isWorkshopLink = (url: string) => /\/pagar\/p\/taller-/i.test(url);

/** Lo que recibe la persona si el modelo volvió a poner el enlace y aun así escaló (el enlace va debajo). */
export const CHAT_LINK_REPLY =
  "Puedes hacer el pago por el enlace que te envió Dayana. Cuando lo hagas, me mandas el comprobante por aquí para que ella lo revise";

/** Un enlace de pago de más de esto ya no cuenta como «el que te mandó Dayana». */
export const CHAT_LINK_MAX_AGE_DAYS = 30;

/**
 * El último enlace de pago que Dayana escribió ella misma en el chat (celular
 * o CRM). Lo que mandó la asistente no cuenta: puede ser el curso en vivo o
 * la sesión urgente, que no son «el enlace que te mandó Dayana».
 */
export const dayanaPaymentLink = (lines: Line[], now: Date = new Date()): { url: string; sentAt: Date | null } | null => {
  const oldest = now.getTime() - CHAT_LINK_MAX_AGE_DAYS * 24 * 3600_000;
  for (let i = lines.length - 1; i >= 0; i--) {
    const l = lines[i];
    if (!byDayana(l) || !l.body) continue;
    if (l.sentAt && l.sentAt.getTime() < oldest) break;
    const urls = l.body.match(PAY_URL)?.filter((u) => !isWorkshopLink(u));
    if (urls?.length) return { url: urls[urls.length - 1].replace(/[.,;:!?]+$/, ""), sentAt: l.sentAt ?? null };
  }
  return null;
};

const NUMBER_WORDS: Record<string, number> = { una: 1, uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, ocho: 8, diez: 10, doce: 12 };

/** «/pagar/p/therapy-3» → «paquete de 3 sesiones»; otro enlace, «enlace de pago». */
const linkLabel = (url: string): string => {
  const n = url.match(/\/pagar\/p\/therapy-(\d+)\b/i)?.[1];
  if (!n) return "enlace de pago";
  return Number(n) === 1 ? "1 sesión" : `paquete de ${n} sesiones`;
};

export type ChatPaymentLink = { url: string; sentAt: Date | null; label: string };

/**
 * Todos los enlaces de pago que Dayana escribió ella misma (30 días), el más
 * nuevo primero y sin repetir. Joselyn (21-oct) recibió el del paquete de 3 y
 * el de 6 sesiones, y la nota de Dayana dice que primero pague el de 3: con
 * solo «el último» se le mandaba el de 6.
 */
export const dayanaPaymentLinks = (lines: Line[], now: Date = new Date()): ChatPaymentLink[] => {
  const oldest = now.getTime() - CHAT_LINK_MAX_AGE_DAYS * 24 * 3600_000;
  const out: ChatPaymentLink[] = [];
  for (let i = lines.length - 1; i >= 0; i--) {
    const l = lines[i];
    if (!byDayana(l) || !l.body) continue;
    if (l.sentAt && l.sentAt.getTime() < oldest) break;
    for (const raw of [...(l.body.match(PAY_URL) ?? [])].reverse()) {
      if (isWorkshopLink(raw)) continue;
      const url = raw.replace(/[.,;:!?]+$/, "");
      if (!out.some((o) => o.url === url)) out.push({ url, sentAt: l.sentAt ?? null, label: linkLabel(url) });
    }
  }
  return out;
};

/**
 * El enlace que se pide («paquete de 3 sesiones», «tres», «therapy-3»); si no
 * se dice cuál o no cuadra con ninguno, el último que mandó Dayana.
 */
export const pickPaymentLink = (links: ChatPaymentLink[], which: string | null | undefined): ChatPaymentLink | null => {
  if (!links.length) return null;
  const w = foldForSearch(which ?? "");
  const num = (s: string | undefined) => (s === undefined ? NaN : /^\d+$/.test(s) ? Number(s) : (NUMBER_WORDS[s] ?? NaN));
  const words = Object.keys(NUMBER_WORDS).join("|");
  // «paquete de 3 sesiones» (también «seciones», como lo escribe la nota); en
  // algo corto («3», «tres», «therapy-3») el número solo. Una fecha de una
  // nota larga («el 6 de octubre») no elige paquete.
  const sessionsWord = "(sesion|sesiones|seciones|secciones)";
  // «paquete de 3 sesiones» manda sobre «ya tuvo 1 sesión» en la misma nota.
  const pack = w.match(new RegExp(`\\bpaquete\\s+de\\s+(\\d{1,2}|${words})\\s+${sessionsWord}\\b`));
  const sessions = w.match(new RegExp(`\\b(\\d{1,2}|${words})\\s+${sessionsWord}\\b`));
  const bare = w.length <= 30 ? w.match(new RegExp(`\\b(\\d{1,2}|${words})\\b`)) : null;
  const n = num(pack?.[1] ?? sessions?.[1] ?? bare?.[1]);
  const byNumber = Number.isNaN(n) ? null : links.find((l) => new RegExp(`/therapy-${n}\\b`, "i").test(l.url));
  return byNumber ?? links[0];
};

/**
 * Cómo pagar, escrito por Dayana (dueña, 21-oct-2026): «una vez Dayana manda
 * la información de pago, ya hubo llamada o conversación de precios». Raquel
 * (19-oct) recibió de Dayana los datos de Western Union y el valor del paquete
 * y aun así le llegó el recordatorio de su llamada gratis del jueves; Carmen
 * (21-oct) recibió su Nequi y el valor, y la asistente le preguntó «¿Pudiste
 * hablar con Dayana?» dos veces.
 */
/** Datos para pagar de verdad: un enlace de pago, una cuenta, Nequi, Western Union. */
const PAYMENT_DATA = [
  /\/pagar\//,
  /\bnequi\b/,
  /\bdaviplata\b/,
  /\b(numero de cuenta|n° cuenta|cuenta de ahorros|cuenta corriente|tipo de cuenta)\b/,
  /\b(titular|a nombre de)\b[^\n]{0,40}\b(cuenta|nequi|banco|daviplata)\b|\b(cuenta|nequi|banco|daviplata)\b[^\n]{0,60}\b(titular|a nombre de)\b/,
  /\bwestern union\b/,
  // Cualquier otro banco o medio (dueña, 22-oct: «Western Union, Bancolombia o
  // cualquier otro»): «Bancolombia ahorros 1234…» no dice «tipo de cuenta».
  // Santander, Azteca, Mercantil solos son lugares o palabras: con «banco».
  /\b(bancolombia|davivienda|bbva|banco (de bogota|popular|de occidente|caja social|santander|azteca|mercantil|pichincha|guayaquil)|av villas|colpatria|scotiabank|itau|banorte|banamex|citibanamex|bancoppel|hsbc|bcp|interbank|produbanco|banreservas|banesco|bancamia)\b/,
  /\b(zelle|yape|plin|clabe|spei|oxxo|binance|remitly|global ?66|moneygram|bre-?b)\b/,
  // PayPal y Mercado Pago son los rieles de la web: nombrarlos («págalo por
  // PayPal en la página») no son datos; su enlace o un correo sí (revisión 22-oct).
  /\bpaypal\.me\b|\bpaypal\b[^\n]{0,30}\b[\w.+-]+@[\w-]+\.[\w.]+|\bmpago\.la\b|\blink\.mercadopago\b/,
  // El número justo después de «cuenta», «ahorros», «CLABE»… No «ten en cuenta
  // que es de 10:00 - 10:15» (revisión 22-oct): ni «en/de cuenta», ni guiones con espacios.
  // Empieza con 4 cifras seguidas: «cuenta 1 2 3 4 5 6 7, respira» no es una cuenta (un IBAN, «ES12 3456…»).
  /(?<!\b(?:en|de|di|doy|da|das|dio|dar|darme|darte)\s)\b(cuenta( de ahorros| corriente| bancaria)?|ahorros|corriente|clabe|cbu|cvu|cci|iban)\b\s*(es|no\.?|nro\.?|n°|#|:)?\s*(?:[a-z]{2}\d{2} ?)?(?=\d{4})(?:\d[ .-]?){7,}/,
];
/** «Envíame el comprobante»: ya hablaron de pagar. */
const RECEIPT_TALK =
  /\bcomprobante\b[^\n]{0,40}\b(pago|pagar|transferencia)\b|\b(envies|envias|enviame|envia|mandes|mandas|mandame|manda)\b[^\n]{0,20}\bcomprobante\b/;
/** Además, lo que dice que ya hablaron de la sesión y el valor: un monto, «envíame el comprobante». */
const PRICE_TALK = [RECEIPT_TALK, /\$\s?\d/, /\b\d{2,3}(\.\d{3})+\b/, /\b\d+(\.\d+)?\s?(usd|cop|mxn|dolares|pesos)\b/];

/** ¿Este mensaje de Dayana trae datos para pagar (enlace, cuenta, Nequi, Western Union)? */
export const isPaymentData = (text: string | null | undefined): boolean => {
  const t = foldForSearch(withoutWorkshopLinks(text ?? ""));
  return Boolean(t) && PAYMENT_DATA.some((re) => re.test(t));
};

/**
 * Un valor suelto que no es el de su proceso: el precio de un curso o un
 * evento (Patricia, 20-oct: «el curso… está en $60»), o lo que cuesta una
 * sesión dicho antes de la llamada («la llamada es para eso…», Montoya, 9-oct).
 * Ninguno de los dos tuvo la llamada, y los dos quedaron en «tuvo la llamada»
 * y recibieron el seguimiento del cierre (23-oct).
 */
const NOT_THERAPY = /\b(curso|cursos|taller|talleres|evento|webinar|clase|clases|diplomado|formacion|certificacion|capacitacion|entrenamiento|membresia|mensualidad)\b/;
const THERAPY = /\b(sesion|sesiones|terapia|terapias|reprogramacion|proceso personalizado|paquete)\b/;
const BEFORE_CALL =
  /\bla llamada es\b[^.\n]{0,25}\bpara\b|\bpara eso es la llamada\b|\ben la llamada (te|se te) (digo|explico|cuento|doy|da)\b|\bagendar (la|una|tu) llamada\b/;
const otherPrice = (t: string) => BEFORE_CALL.test(t) || (NOT_THERAPY.test(t) && !THERAPY.test(t));

/** ¿Este mensaje de Dayana dice que ya hablaron de pagar (datos, un valor, «mándame el comprobante»)? */
export const isPaymentInfo = (text: string | null | undefined, opts: { amounts?: boolean } = {}): boolean => {
  const t = foldForSearch(withoutWorkshopLinks(text ?? ""));
  if (!t) return false;
  if (PAYMENT_DATA.some((re) => re.test(t)) || RECEIPT_TALK.test(t)) return true;
  // Sin `amounts`, un monto suelto no cuenta (un precio de un taller de hace
  // meses no dice que tuvo su llamada): solo datos o «mándame el comprobante».
  if (opts.amounts === false) return false;
  return PRICE_TALK.slice(1).some((re) => re.test(t)) && !otherPrice(t);
};

/**
 * Los mensajes con datos para pagar que Dayana escribió ella misma en los
 * últimos 30 días (para comprobar una cuenta copiada): una cuenta de hace meses
 * puede ya no ser la que usa.
 */
export const dayanaPaymentDataBodies = (lines: Line[], now: Date = new Date()): string[] => {
  const oldest = now.getTime() - CHAT_LINK_MAX_AGE_DAYS * 24 * 3600_000;
  return lines.filter((l) => byDayana(l) && (!l.sentAt || l.sentAt.getTime() >= oldest) && isPaymentData(l.body)).map((l) => l.body as string);
};

/**
 * El paquete que nombra («las 6 sesiones», «el paquete de seis», «quiero el de
 * 6»); null si no nombra ninguno. «El de 3:00» es una hora.
 */
export const askedPackage = (text: string): number | null => {
  const w = foldForSearch(text);
  const words = Object.keys(NUMBER_WORDS).join("|");
  const m =
    w.match(new RegExp(`\\b(\\d{1,2}|${words})\\s+(sesion|sesiones|seciones|secciones)\\b`)) ??
    w.match(new RegExp(`\\b(?:paquete|plan) de (\\d{1,2}|${words})\\b(?![:.]\\d)`)) ??
    w.match(new RegExp(`\\bel de (\\d{1,2}|${words})\\b(?![:.]\\d|\\s?(?:am|pm|a\\.|p\\.|de la|del|hora))`));
  if (!m) return null;
  const n = /^\d+$/.test(m[1]) ? Number(m[1]) : NUMBER_WORDS[m[1]];
  return n ?? null;
};

/** Qué trae un mensaje de pago: datos (enlace, cuenta, Nequi…), «mándame el comprobante» o solo un valor. */
export const paymentInfoKind = (text: string | null | undefined): "data" | "receipt" | "amount" | null => {
  const t = foldForSearch(withoutWorkshopLinks(text ?? ""));
  if (!t) return null;
  if (PAYMENT_DATA.some((re) => re.test(t))) return "data";
  if (RECEIPT_TALK.test(t)) return "receipt";
  return PRICE_TALK.slice(1).some((re) => re.test(t)) ? "amount" : null;
};

/**
 * Lo último que Dayana escribió ella misma con datos para pagar (30 días): un
 * enlace, una cuenta, Nequi, Western Union. Solo un valor o «mándame el
 * comprobante» no cuenta aquí: sin datos, la asistente sí se los da.
 */
export const dayanaPaymentInfo = (lines: Line[], now: Date = new Date()): { sentAt: Date | null; link: string | null } | null => {
  const oldest = now.getTime() - CHAT_LINK_MAX_AGE_DAYS * 24 * 3600_000;
  for (let i = lines.length - 1; i >= 0; i--) {
    const l = lines[i];
    if (!byDayana(l) || !l.body) continue;
    if (l.sentAt && l.sentAt.getTime() < oldest) break;
    if (isPaymentData(l.body)) return { sentAt: l.sentAt ?? null, link: dayanaPaymentLink(lines, now)?.url ?? null };
  }
  return null;
};

/**
 * El modelo a veces copia el enlace de la conversación en su mensaje (y el
 * arreglo de mayúsculas lo deja «Https://…»). Se quita de su texto y el código
 * lo pega debajo, como con `send_payment_link`. `had`: había alguno.
 */
export const withoutPayUrls = (text: string): { text: string; had: boolean } => {
  const cleaned = text.replace(new RegExp(PAY_URL.source, "gi"), "");
  if (cleaned === text) return { text, had: false };
  return {
    text: cleaned
      .split("\n")
      .map((l) => l.replace(/[ \t]+$/, ""))
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
      // «…desde ahí:» y el enlace en la línea siguiente: queda en punto.
      .replace(/:(?=\n)/g, ".")
      // «…por ahí:» sin nada después: los dos puntos los vuelve a poner quien pega el enlace.
      .replace(/:$/, "")
      .trim(),
    had: true,
  };
};

/** Pide la cuenta o transferir, otro medio, o el enlace no le sirve. */
const BANK = [
  // «la cuenta», no «me di cuenta» ni «tener en cuenta».
  /(?<!\b(?:di|doy|da|das|dio|dar|dando|dimos|dieron|darme|darte|en)\s)\bcuentas?\b/,
  /\btransfer\w*/,
  /\bconsign\w*/,
  /\bdatos\b/,
  /\bbanc\w*/,
  /\bnequi\b/,
  /\bdaviplata\b/,
  /\bwestern\b/,
  /\bglobal ?66\b/,
  /\bremitly\b/,
  /\bpaypal\b/,
  /\bzelle\b/,
  /\befectivo\b/,
  /\b(sin|no tengo|no uso) tarjeta\b/,
  /\b(otra forma|otro medio|otra manera|otro metodo) de pago\b/,
  /\b(link|enlace|pagina)\b.*\bno (me )?(deja|abre|funciona|sirve|carga|sale)\b/,
  /\bno (me )?(deja|abre|funciona|sirve|carga|sale)\b.*\b(link|enlace|pagina|pagar|pago)\b/,
  /\bno (pude|puedo|me deja) pagar\b/,
];

/** ¿Lo último que escribió la persona pide los datos de la cuenta (y no solo pagar)? */
export const asksForBankDetails = (texts: string[]): boolean => {
  const t = foldForSearch(texts.join("\n"));
  return BANK.some((re) => re.test(t));
};
