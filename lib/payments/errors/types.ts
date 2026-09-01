/**
 * Un fallo de pago, ya traducido.
 *
 * ## Por qué existe esto
 *
 * Una clienta pagó, PayPal devolvió 422 —su banco había rechazado la tarjeta— y
 * la pantalla le dijo «se está procesando tu pago». El motivo real no se supo
 * hasta llamar a PayPal por teléfono. El código tiraba la respuesta del
 * proveedor: `new Error("PayPal capture failed (422): …")` aplasta en un string
 * el `details[].issue` —donde PayPal dice `INSTRUMENT_DECLINED`— y el
 * `debug_id`, que es justo lo que PayPal pide para dar soporte.
 *
 * ## Dos mensajes, a propósito
 *
 * `buyerMessage` es para quien intentó pagar: dice qué hacer ahora, sin jerga
 * ni códigos. `staffMessage` es para Dayana: dice qué pasó de verdad y lleva el
 * identificador con el que reclamar al proveedor. Un solo texto obligaría a
 * elegir entre asustar a la clienta o dejar al equipo sin información.
 *
 * ## `outcome` decide la pantalla
 *
 * `rejected` es definitivo: el banco dijo que no y esperar no lo arregla.
 * `pending` es un pago en curso de verdad —un PSE, un efectivo— que se
 * confirmará solo. `succeeded` existe porque algunos «errores» no lo son:
 * capturar dos veces la misma orden devuelve error y significa que ya estaba
 * cobrada. Confundir esos tres es exactamente lo que hacía la pantalla vieja.
 */

export type PaymentFailureOutcome =
  /** Definitivo. Reintentar lo mismo volverá a fallar. */
  | "rejected"
  /** En curso. Se resuelve solo; no es un fallo. */
  | "pending"
  /** No era un error: el pago ya estaba cobrado. */
  | "succeeded"
  /** No se pudo clasificar. Se trata como pendiente, nunca como rechazo. */
  | "unknown";

export type PaymentFailureProvider = "PAYPAL" | "MERCADO_PAGO";

export type PaymentFailure = {
  outcome: PaymentFailureOutcome;
  provider: PaymentFailureProvider;
  /**
   * Código normalizado y estable, el que se guarda en `Payment.failureCode` y
   * viaja en la URL de la pantalla de resultado. No es el crudo del proveedor:
   * eso va en `rawCode`.
   */
  code: string;
  /** Tal cual lo devolvió el proveedor (`issue` o `status_detail`). */
  rawCode?: string;
  /** `debug_id` de PayPal: sin esto su soporte no puede buscar la operación. */
  debugId?: string;
  /** Para la clienta. Qué pasó y qué puede hacer. */
  buyerMessage: string;
  /** Para el equipo. Incluye lo técnico. */
  staffMessage: string;
  /** ¿Tiene sentido volver a intentarlo con el mismo medio? */
  retryable: boolean;
};

/** Cuando no hay nada que interpretar. Nunca se declara un rechazo a ciegas. */
export const unknownFailure = (
  provider: PaymentFailureProvider,
  detail?: string
): PaymentFailure => ({
  outcome: "unknown",
  provider,
  code: "UNKNOWN",
  buyerMessage:
    "No pudimos confirmar el estado de tu pago. Si ves un cargo, escríbenos y lo revisamos enseguida.",
  staffMessage: detail
    ? `Respuesta no reconocida del proveedor: ${detail}`
    : "Respuesta no reconocida del proveedor.",
  retryable: true,
});
