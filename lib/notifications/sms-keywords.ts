/**
 * Palabras clave de un SMS entrante.
 *
 * Módulo puro y sin dependencias: la ruta se queda en verificar → clasificar →
 * aplicar → responder.
 */
export type SmsKeyword = "STOP" | "START" | "HELP" | null;

/**
 * "BAJA" y "baja." y "Bájà" son la misma intención. Se quitan tildes, se pasa a
 * mayúsculas y se descarta todo lo que no sea letra, así que la puntuación y
 * los espacios dejan de importar ("STOP ALL" queda "STOPALL").
 */
export const normalizeKeyword = (body: string): string =>
  body
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z]/g, "");

const STOP_WORDS = new Set([
  "STOP",
  "STOPALL",
  "UNSUBSCRIBE",
  "END",
  "QUIT",
  "CANCEL",
  "REVOKE",
  "OPTOUT",
  "BAJA",
  "CANCELAR",
  "SALIR",
  "ELIMINAR",
  "PARAR",
  "DETENER",
]);

// "NO" queda fuera a propósito: es una respuesta plausible a cualquier pregunta
// de sí/no que mande el CRM y daría de baja a gente por accidente.
const START_WORDS = new Set([
  "START",
  "YES",
  "UNSTOP",
  "SI",
  "ALTA",
  "SUSCRIBIR",
  "ACEPTO",
]);

const HELP_WORDS = new Set(["HELP", "INFO", "AYUDA", "SOPORTE"]);

/**
 * Solo hay coincidencia cuando el mensaje ENTERO es la palabra clave: "stop by
 * my house" no es una baja.
 */
export const classifySmsKeyword = (body: string | null | undefined): SmsKeyword => {
  if (!body) return null;
  const word = normalizeKeyword(body);
  if (!word) return null;
  if (STOP_WORDS.has(word)) return "STOP";
  if (START_WORDS.has(word)) return "START";
  if (HELP_WORDS.has(word)) return "HELP";
  return null;
};

/**
 * Respuestas automáticas SIN TILDES a propósito.
 *
 * Un solo carácter acentuado saca al mensaje de GSM-7 (160 caracteres por
 * segmento) y lo mete en UCS-2 (70), lo que casi duplica el costo. El idioma
 * sigue siendo español; lo único que se sacrifica es la tilde, y solo en estos
 * textos del sistema — nunca en lo que escribe una persona en una campaña.
 */
export const SMS_AUTO_REPLY: Record<Exclude<SmsKeyword, null>, string> = {
  STOP: "Listo. No recibiras mas SMS de Dayana Beltran PNL. Escribe ALTA para volver a recibirlos.",
  START:
    "Listo. Volveras a recibir SMS de Dayana Beltran PNL. Escribe BAJA para darte de baja.",
  HELP: "Dayana Beltran PNL. Ayuda: contacto@dayanabeltran.com. Escribe BAJA para dejar de recibir SMS.",
};
