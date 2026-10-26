/**
 * Qué clase de fallo de correo es, a partir del texto que deja `sendViaResend`
 * (`Resend error: <status> <cuerpo>`).
 *
 * Importa porque no todos los fallos piden lo mismo:
 *
 * - **`quota`**: la cuenta de Resend agotó su tope diario o mensual. No es
 *   culpa de ningún destinatario y reintentar a cada persona en cada pasada
 *   sólo genera cientos de intentos que fallan igual (el 24-25 oct fueron
 *   1.026 en dos días) y un aviso al equipo por cada uno.
 * - **`invalid_address`**: Resend rechaza el `to` por formato. Es permanente
 *   para ESA dirección: reintentarla cada diez minutos no la arregla (una
 *   persona acumuló 20 intentos).
 * - **`other`**: todo lo demás se trata como hasta ahora.
 *
 * Distingue la cuota del límite de ritmo (`rate_limit_exceeded`, 10 peticiones
 * por segundo): ese sí se resuelve esperando un instante y el mailer ya lo
 * evita con su ranura de 125 ms, así que no debe frenar el envío.
 */

export type EmailErrorKind = "quota" | "invalid_address" | "other";

export const classifyEmailError = (
  message: string | null | undefined
): EmailErrorKind => {
  const text = message ?? "";
  if (
    /Resend error: 429/.test(text) &&
    /(daily|monthly)_quota_exceeded/.test(text)
  ) {
    return "quota";
  }
  if (/Resend error: 422/.test(text) && /Invalid `to` field/.test(text)) {
    return "invalid_address";
  }
  return "other";
};

export const isEmailQuotaError = (message: string | null | undefined): boolean =>
  classifyEmailError(message) === "quota";

/**
 * Plantillas de los barridos AUTOMÁTICOS (recordatorios y enlace del webinar,
 * recordatorios de talleres). Son las que gobierna el freno de cuota y las que
 * se reintentan solas: su fallo por cuota se avisa UNA vez, al activarse el
 * freno. Todo lo demás —confirmación de pago, invitación al portal, código de
 * pago— se manda de una en una, no se reintenta, y si no sale hay que saberlo.
 */
const GATED_SWEEP_TEMPLATES: ReadonlySet<string> = new Set([
  "webinar_meet_link",
  "webinar_reminder_24h",
  "webinar_reminder_1h",
  "workshop_reminder_24h",
  "workshop_reminder_1h",
]);

/**
 * Lista explícita y no un prefijo: `workshop_open` (la difusión de un taller
 * desde el panel) empieza igual pero NO es un barrido, y tratarla como tal
 * habría dado por avisado un fallo que nadie ha avisado.
 */
export const isGatedSweepTemplate = (templateKey?: string | null): boolean =>
  templateKey != null && GATED_SWEEP_TEMPLATES.has(templateKey);

/**
 * Clave con la que el aviso de «no se pudo entregar» se agrupa en la campana
 * (la agrupación del catálogo junta avisos del mismo evento + entidad dentro
 * de su ventana). Siempre incluye la plantilla salvo para una dirección
 * inválida: así un fallo del recordatorio de 1 h no tapa el de una
 * confirmación de pago, ni un apagón de cuota que afecta a una confirmación se
 * pierde dentro del aviso general del apagón.
 */
export const deliveryFailureKey = (
  channel: string,
  kind: EmailErrorKind,
  templateKey?: string | null
): string =>
  kind === "invalid_address"
    ? `${channel}:${kind}`
    : `${channel}:${kind === "quota" ? "quota:" : ""}${templateKey ?? "-"}`;
