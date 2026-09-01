import {
  unknownFailure,
  type PaymentFailure,
  type PaymentFailureOutcome,
} from "./types";

/**
 * Traduce el `status_detail` de Mercado Pago.
 *
 * MP devuelve `status` (`approved` / `rejected` / `in_process` / `pending`) y
 * junto a él un `status_detail` que dice el motivo exacto: si faltó saldo, si
 * el CVV está mal, si el banco pide autorización. **Hasta ahora no se leía en
 * ningún sitio del repo** — cero ocurrencias — así que todos los rechazos se
 * mostraban igual, y «revisa el código de seguridad» y «no tienes saldo»
 * acababan en el mismo mensaje inútil.
 *
 * Lo importante de esta tabla no son sólo los rechazos: los `pending_*` NO son
 * fallos. Un PSE o un pago en efectivo viven ahí durante horas y se confirman
 * solos. Tratarlos como error le diría a alguien que su pago falló mientras va
 * camino del banco a pagarlo.
 */

type Entry = {
  outcome: PaymentFailureOutcome;
  buyer: string;
  staff: string;
  retryable: boolean;
};

const rejected = (buyer: string, staff: string, retryable = true): Entry => ({
  outcome: "rejected",
  buyer,
  staff,
  retryable,
});

const pending = (buyer: string, staff: string): Entry => ({
  outcome: "pending",
  buyer,
  staff,
  retryable: false,
});

const DETAILS: Record<string, Entry> = {
  // ── Datos mal escritos: se arregla reintentando con cuidado ─────────────
  cc_rejected_bad_filled_card_number: rejected(
    "El número de la tarjeta no es correcto. Revísalo e inténtalo de nuevo.",
    "Número de tarjeta mal ingresado."
  ),
  cc_rejected_bad_filled_date: rejected(
    "La fecha de vencimiento no es correcta. Revísala e inténtalo de nuevo.",
    "Fecha de vencimiento mal ingresada."
  ),
  cc_rejected_bad_filled_security_code: rejected(
    "El código de seguridad no es correcto. Revísalo e inténtalo de nuevo.",
    "CVV mal ingresado."
  ),
  cc_rejected_bad_filled_other: rejected(
    "Alguno de los datos de la tarjeta no es correcto. Revísalos e inténtalo de nuevo.",
    "Datos de la tarjeta mal ingresados."
  ),

  // ── El banco dijo que no ────────────────────────────────────────────────
  cc_rejected_insufficient_amount: rejected(
    "Tu tarjeta no tiene saldo suficiente para este pago.",
    "Fondos insuficientes."
  ),
  cc_rejected_call_for_authorize: rejected(
    "Tu banco necesita que autorices este pago. Llámalos e inténtalo de nuevo.",
    "El banco exige autorización previa de la titular para este importe."
  ),
  cc_rejected_card_disabled: rejected(
    "Tu tarjeta está inactiva. Llama a tu banco para activarla y vuelve a intentarlo.",
    "Tarjeta inhabilitada; la titular debe activarla con su banco."
  ),
  cc_rejected_card_error: rejected(
    "No pudimos procesar tu tarjeta. Inténtalo de nuevo o usa otro medio de pago.",
    "Error genérico de la tarjeta."
  ),
  cc_rejected_blacklist: rejected(
    "No pudimos procesar este pago. Prueba con otro medio o escríbenos.",
    "Tarjeta en lista negra de Mercado Pago.",
    false
  ),
  cc_rejected_high_risk: rejected(
    "El pago fue rechazado por seguridad. Prueba con otro medio de pago.",
    "Rechazado por el motor antifraude de MP.",
    false
  ),
  rejected_by_bank: rejected(
    "Tu banco rechazó la operación. Puedes intentar con otra tarjeta o llamarlos.",
    "Rechazo del banco emisor."
  ),
  rejected_by_regulations: rejected(
    "No pudimos procesar este pago por restricciones de la entidad. Escríbenos y te damos otra vía.",
    "Rechazado por normativa.",
    false
  ),
  rejected_insufficient_data: rejected(
    "Faltan datos para completar el pago. Inténtalo de nuevo.",
    "Faltan datos obligatorios del pagador."
  ),

  // ── Límites ─────────────────────────────────────────────────────────────
  cc_rejected_max_attempts: rejected(
    "Llegaste al límite de intentos con esa tarjeta. Prueba con otra o espera un rato.",
    "Máximo de intentos alcanzado.",
    false
  ),
  cc_amount_rate_limit_exceeded: rejected(
    "El importe supera el límite de tu tarjeta. Prueba con otro medio de pago.",
    "Importe por encima del límite permitido para la tarjeta."
  ),
  cc_rejected_invalid_installments: rejected(
    "Tu tarjeta no admite ese número de cuotas. Elige otra opción.",
    "Cuotas no admitidas por el emisor."
  ),

  /**
   * NO es un fallo nuevo: ya se cobró una vez. Decirle «rechazado» a quien
   * acaba de pagar es peor que no decirle nada.
   */
  cc_rejected_duplicated_payment: {
    outcome: "succeeded",
    buyer:
      "Ya hiciste un pago por ese valor. Si crees que se cobró dos veces, escríbenos.",
    staff: "Pago duplicado: MP detectó un cobro idéntico reciente.",
    retryable: false,
  },

  cc_rejected_3ds_mandatory: rejected(
    "Tu banco exige una verificación adicional. Vuelve a intentarlo y complétala.",
    "Falta el reto 3-D Secure, obligatorio para esta tarjeta."
  ),

  // ── En curso: NO son errores ────────────────────────────────────────────
  pending_waiting_payment: pending(
    "Ya generamos tu pago. En cuanto lo completes en el banco o el punto de pago, te llega el acceso.",
    "Efectivo o PSE pendiente de que la clienta lo complete."
  ),
  pending_waiting_transfer: pending(
    "Estamos esperando la confirmación de tu transferencia. Te avisamos en cuanto llegue.",
    "Transferencia bancaria en curso."
  ),
  pending_challenge: pending(
    "Falta que confirmes el pago con tu banco. Revisa la app o el SMS que te enviaron.",
    "Pendiente del reto 3-D Secure."
  ),
  pending_review_manual: pending(
    "Estamos revisando tu pago. Te avisamos en cuanto se confirme.",
    "En revisión manual de Mercado Pago."
  ),
  pending_contingency: pending(
    "Tu pago se está procesando. Te avisamos en cuanto se confirme.",
    "Contingencia de Mercado Pago; se resuelve solo."
  ),
};

/**
 * @param statusDetail el `status_detail` que devuelve la API de MP
 * @param status el `status`, para clasificar cuando el detalle es desconocido
 */
export const mapMercadoPagoStatus = (
  statusDetail?: string | null,
  status?: string | null
): PaymentFailure => {
  const entry = statusDetail ? DETAILS[statusDetail] : undefined;

  if (entry) {
    return {
      outcome: entry.outcome,
      provider: "MERCADO_PAGO",
      code: statusDetail!,
      rawCode: statusDetail!,
      buyerMessage: entry.buyer,
      staffMessage: entry.staff,
      retryable: entry.retryable,
    };
  }

  /**
   * Detalle desconocido. Se cae al `status`, que sí es un conjunto cerrado —
   * así un `cc_rejected_*` nuevo de MP sigue clasificándose como rechazo en vez
   * de quedarse en «no sabemos».
   */
  if (status === "rejected") {
    return {
      outcome: "rejected",
      provider: "MERCADO_PAGO",
      code: statusDetail ?? "rejected",
      rawCode: statusDetail ?? undefined,
      buyerMessage:
        "Tu pago fue rechazado. Puedes intentar con otro medio de pago o escribirnos.",
      staffMessage: `Rechazado por Mercado Pago${statusDetail ? ` (${statusDetail})` : ""}.`,
      retryable: true,
    };
  }
  if (status === "pending" || status === "in_process" || status === "authorized") {
    return {
      outcome: "pending",
      provider: "MERCADO_PAGO",
      code: statusDetail ?? status,
      rawCode: statusDetail ?? undefined,
      buyerMessage:
        "Tu pago se está procesando. Te avisamos en cuanto se confirme.",
      staffMessage: `Pendiente en Mercado Pago${statusDetail ? ` (${statusDetail})` : ""}.`,
      retryable: false,
    };
  }
  if (status === "approved") {
    return {
      outcome: "succeeded",
      provider: "MERCADO_PAGO",
      code: statusDetail ?? "approved",
      rawCode: statusDetail ?? undefined,
      buyerMessage: "Tu pago está confirmado.",
      staffMessage: "Aprobado.",
      retryable: false,
    };
  }

  return {
    ...unknownFailure("MERCADO_PAGO", statusDetail ?? status ?? undefined),
    rawCode: statusDetail ?? undefined,
  };
};
