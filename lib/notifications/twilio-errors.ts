/**
 * Códigos de error de Twilio que llegan por el StatusCallback.
 *
 * La lista no pretende ser completa: cualquier código desconocido se guarda
 * igual en `errorMessage` como "Twilio <código>", que sigue siendo buscable en
 * el registro de envíos.
 */
export const TWILIO_ERROR_TEXT: Record<number, string> = {
  21211: "El número no es válido.",
  21408: "No hay permiso para enviar SMS a ese país.",
  21610: "El destinatario se dio de baja (respondió STOP).",
  21614: "El número no puede recibir SMS.",
  30003: "El teléfono está apagado o sin cobertura.",
  30004: "El número bloqueó los mensajes.",
  30005: "El número no existe o ya no está en servicio.",
  30006: "Es una línea fija o no acepta SMS.",
  30007: "El operador filtró el mensaje como spam.",
  30008: "Entrega fallida sin causa reportada por el operador.",
};

/**
 * Errores que describen algo permanente del destinatario, no de este mensaje.
 * Solo estos apagan `notifySms`.
 *
 * Quedan fuera a propósito:
 * - 30003: teléfono apagado o sin cobertura. Es temporal; darlo de baja a la
 *   primera borra en silencio a gente que sí es contactable.
 * - 30007: filtro del operador. Es un problema de contenido o de registro
 *   (10DLC), no del contacto: dar de baja al contacto culpa al equivocado y
 *   además encoge la audiencia mientras lo que falla es el registro.
 */
export const SMS_PERMANENT_ERROR_CODES = new Set([
  21211, 21610, 21614, 30005, 30006,
]);

export const describeTwilioError = (code: number | null): string => {
  if (code == null) return "Twilio no reportó un código de error.";
  const text = TWILIO_ERROR_TEXT[code];
  return text ? `Twilio ${code}: ${text}` : `Twilio ${code}`;
};

export const isPermanentSmsError = (code: number | null): boolean =>
  code != null && SMS_PERMANENT_ERROR_CODES.has(code);
