import { foldForSearch } from "../search-normalize";

/**
 * Pagó por otra persona de su familia, o esa persona ya empezó con Dayana
 * (Malka, 28-oct: tras la cotización de sus 6 sesiones escribió «Porq decidí /
 * Pagarle / A mi hija primero / Mañana / Tiene su primera cita / Con usted», y
 * la IA le contestó «cuando realices el pago, me envías el comprobante»).
 * Dueña: «ella dijo que ya pagó: en ese caso es una transferencia a Dayana».
 *
 * Puro. Lee la ráfaga entera (lo escribe en varios mensajes cortos).
 */
const FAMILY =
  "(hija|hijo|hijas|hijos|esposo|esposa|marido|mama|madre|papa|padre|hermana|hermano|nieta|nieto|sobrina|sobrino|pareja|novio|novia|amiga|amigo|prima|primo|tia|tio)";
/** «Decidí pagarle a mi hija primero», «le pagué a mi hijo», «pagamos lo de mi esposo». */
const PAID_FOR = new RegExp(`\\b(pague|pagarle|le pague|pagamos|ya pague|pague lo de|pagamos lo de)\\b[^.?!]{0,30}\\bmi ${FAMILY}\\b`);
/** «Mi hija ya tiene su primera cita», «mi hijo empieza mañana con usted». */
const FAMILY_STARTED = new RegExp(
  `\\bmi ${FAMILY}\\b[^.?!]{0,40}\\b(tiene|empieza|inicia|comienza|arranca|ya pago|pago)\\b[^.?!]{0,40}\\b(cita|sesion|sesiones|terapia|proceso|con usted|con dayana)\\b`
);
/** «Tiene su primera cita» con la familia nombrada en la misma ráfaga. */
const FIRST_SESSION = /\b(tiene|empieza|inicia) su primera (cita|sesion|terapia)\b/;
/** No puede pagarle a alguien: eso es «no le alcanza», no un pago. */
const CANT = /\bno (tengo|puedo|me alcanza|alcanzo|he podido)\b/;

export const paidForFamily = (texts: (string | null | undefined)[]): boolean => {
  const t = foldForSearch(texts.filter(Boolean).join(" ")).replace(/\s+/g, " ");
  if (!t || CANT.test(t)) return false;
  return PAID_FOR.test(t) || FAMILY_STARTED.test(t) || (FIRST_SESSION.test(t) && new RegExp(`\\bmi ${FAMILY}\\b`).test(t));
};

/** La respuesta: se lo pasamos a Dayana (ella confirma), sin pedirle otro pago. */
export const familyPaidReply = (first: string | null): string =>
  `${first ? `Gracias por contarme, ${first} 🙏` : "Gracias por contarme 🙏"} Le aviso a Dayana para que lo tenga presente; ella te confirma por aquí.`;
