import { foldForSearch } from "../search-normalize";

/**
 * Fase 4 de la arquitectura (dueña, 22-nov: «datos reales»): lo que la IA afirma tiene que
 * salir de un dato. Las horas, los precios, los enlaces y «pago confirmado» ya los pone o
 * los frena el código; aquí van los dos huecos que quedaban (auditoría 7–21 nov):
 *
 * 1. Prometer los datos de pago y no mandarlos (Gissella dos veces: «te comparto los datos
 *    de Western Union» y nada; Yuri). El código pega la forma de pago que corresponde —la
 *    que nombra por su palabra principal, o la de su país— y si no hay ninguna, la promesa no
 *    sale sola.
 * 2. Decir lo que Dayana hizo o pidió sin que conste («Dayana me pidió que te confirmara…»,
 *    Judith; «Dayana intentó comunicarse contigo», Negra): esa frase no sale si no hay una
 *    instrucción de Dayana para ese chat.
 *
 * Puro: sin base de datos.
 */

export type PayMethod = { key: string; label: string; when: string; details: string };

/** «Te comparto los datos», «aquí van las cuentas», «te paso la información de pago»… */
const PROMISES_DATA =
  /\b(te (comparto|paso|envio|mando|dejo|escribo|los comparto|las comparto)|ya te (paso|envio|mando|comparto)|aqui (tienes|van|te dejo|estan|te van)|a continuacion (te comparto|van|tienes))\b[^.!?\n]{0,30}\b(datos|cuenta|cuentas|numero de cuenta|informacion (de pago|para (el )?pago|bancaria|para pagar)|forma de pago|medios? de pago)\b/;

export const promisesPaymentData = (text: string): boolean => PROMISES_DATA.test(foldForSearch(text));

/** Palabras que no distinguen una forma de pago de otra. */
const GENERIC = new Set(["banco", "pago", "pagos", "cuenta", "ahorros", "corriente", "desde", "para", "colombia"]);

/** Las palabras propias de una forma de pago («western», «union», «bancolombia», «nequi»). */
const methodWords = (m: PayMethod): string[] =>
  [...new Set([m.key, ...m.label.split(/[^\p{L}\p{N}]+/u)].map((w) => foldForSearch(w)).filter((w) => w.length >= 4 && !GENERIC.has(w)))];

/** La forma de pago que nombra el texto (por su palabra principal, no el nombre completo). */
export const methodNamedIn = (text: string, methods: PayMethod[]): PayMethod | null => {
  const t = foldForSearch(text);
  const hits = methods.filter((m) => methodWords(m).some((w) => new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(t)));
  return hits.length === 1 ? hits[0] : null;
};

/** ¿«Cuándo usarla» dice que es para Colombia (y no «fuera de Colombia»)? */
const forColombia = (m: PayMethod) => /\bcolombia\b/.test(foldForSearch(m.when)) && !/\b(fuera|exterior|otros? pais|internacional)\b/.test(foldForSearch(m.when));
const forAbroad = (m: PayMethod) => /\b(fuera|exterior|otros? pais|internacional)\b/.test(foldForSearch(m.when));

/**
 * La que le toca: la que nombra; si no nombra ninguna, la única que hay o la de su país
 * (por el «cuándo usarla» de Ajustes: «Pagos desde Colombia» / «fuera de Colombia»). Null si
 * no se puede saber (dos para Colombia, ninguna dice el país…): ahí no se adivina.
 */
export const methodFor = (text: string, methods: PayMethod[], countryIso: string | null): PayMethod | null => {
  if (methods.length === 0) return null;
  const named = methodNamedIn(text, methods);
  if (named) return named;
  if (methods.length === 1) return methods[0];
  if (!countryIso) return null;
  const pool = countryIso === "CO" ? methods.filter(forColombia) : methods.filter(forAbroad);
  return pool.length === 1 ? pool[0] : null;
};

/** Lo que sale en vez de una promesa de datos que el código no pudo cumplir. */
export const DATA_LATER_REPLY = "Dayana te comparte por aquí los datos para el pago. Cuando lo hagas, me mandas el comprobante para que Dayana lo revise.";

/**
 * Lo que Dayana hizo o pidió, contado por la IA: «Dayana me pidió / me dijo / me indicó que
 * te…», «Dayana intentó comunicarse / llamarte / contactarte». Solo vale con una instrucción
 * de Dayana para este chat (`backed`).
 */
const DAYANA_CLAIM =
  /\bdayana (me |nos )?(pidio|dijo|indico|comento|encargo|solicito|aviso) (que )?(te|le|les)\b|\bdayana (intento|trato de|estuvo intentando) (comunicarse|llamarte|contactarte|escribirte|localizarte)\b/;

export const claimsDayanaAction = (text: string): boolean => DAYANA_CLAIM.test(foldForSearch(text));

/** Quita las frases que cuentan algo de Dayana sin respaldo. `removed`: había alguna. */
export const withoutUnbackedDayanaClaims = (text: string, backed: boolean): { text: string; removed: boolean } => {
  if (backed || !claimsDayanaAction(text)) return { text, removed: false };
  const kept = text
    .split("\n")
    .map((line) =>
      line
        .split(/(?<=[.!?…])\s+/)
        .filter((sentence) => !DAYANA_CLAIM.test(foldForSearch(sentence)))
        .join(" ")
    )
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { text: kept, removed: true };
};
