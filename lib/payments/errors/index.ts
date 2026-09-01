/**
 * Traducción de errores de pasarela a algo que la clienta entienda.
 *
 * Un único sitio donde se decide qué significa un código de PayPal o de
 * Mercado Pago. Antes cada capa improvisaba: el error se aplastaba en un
 * string, se perdía el motivo, y la pantalla final decía «se está procesando»
 * sobre un rechazo definitivo del banco.
 */
export { parsePayPalError, PayPalApiError } from "./paypal";
export { mapMercadoPagoStatus } from "./mercadopago";
export {
  unknownFailure,
  type PaymentFailure,
  type PaymentFailureOutcome,
  type PaymentFailureProvider,
} from "./types";
