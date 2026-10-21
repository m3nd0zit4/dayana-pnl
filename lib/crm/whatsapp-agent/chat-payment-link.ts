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
    const urls = l.body.match(PAY_URL);
    if (urls?.length) return { url: urls[urls.length - 1].replace(/[.,;:!?]+$/, ""), sentAt: l.sentAt ?? null };
  }
  return null;
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
];
/** Además, lo que dice que ya hablaron de la sesión y el valor: un monto, «envíame el comprobante». */
const PRICE_TALK = [
  /\bcomprobante\b[^\n]{0,40}\b(pago|pagar|transferencia)\b|\b(envies|envias|enviame|envia|mandes|mandas|mandame|manda)\b[^\n]{0,20}\bcomprobante\b/,
  /\$\s?\d/,
  /\b\d{2,3}(\.\d{3})+\b/,
  /\b\d+(\.\d+)?\s?(usd|cop|mxn|dolares|pesos)\b/,
];

/** ¿Este mensaje de Dayana trae datos para pagar (enlace, cuenta, Nequi, Western Union)? */
export const isPaymentData = (text: string | null | undefined): boolean => {
  const t = foldForSearch(text ?? "");
  return Boolean(t) && PAYMENT_DATA.some((re) => re.test(t));
};

/** ¿Este mensaje de Dayana dice que ya hablaron de pagar (datos, un valor, «mándame el comprobante»)? */
export const isPaymentInfo = (text: string | null | undefined): boolean => {
  const t = foldForSearch(text ?? "");
  return Boolean(t) && (PAYMENT_DATA.some((re) => re.test(t)) || PRICE_TALK.some((re) => re.test(t)));
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
