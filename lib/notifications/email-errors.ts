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
 * Clave con la que el aviso de «no se pudo entregar» se agrupa en la campana
 * (la agrupación del catálogo junta avisos del mismo evento + entidad dentro
 * de su ventana). Canal + causa cuando la causa es conocida; canal + plantilla
 * si no, para que un fallo del recordatorio de 1 h no tape el de una
 * confirmación de pago.
 */
export const deliveryFailureKey = (
  channel: string,
  kind: EmailErrorKind,
  templateKey?: string | null
): string =>
  kind === "other"
    ? `${channel}:${templateKey ?? "-"}`
    : `${channel}:${kind}`;
