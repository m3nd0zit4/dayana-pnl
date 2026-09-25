/**
 * Palabras que Dayana no usa, corregidas antes de enviar (no depende de que el
 * modelo se acuerde). Dayana nunca dice «De nada»: dice «Con gusto».
 */
export const withDayanaWording = (text: string): string =>
  text.replace(/(^|[.!?¡¿\n]\s*)de nada\b/gi, "$1Con gusto");
