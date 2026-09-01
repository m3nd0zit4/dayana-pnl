import {
  unknownFailure,
  type PaymentFailure,
  type PaymentFailureOutcome,
} from "./types";

/**
 * Traduce un error de la API de PayPal.
 *
 * PayPal responde así cuando algo falla:
 *
 * ```json
 * { "name": "UNPROCESSABLE_ENTITY",
 *   "details": [{ "issue": "INSTRUMENT_DECLINED", "description": "…" }],
 *   "debug_id": "a1b2c3", "message": "…" }
 * ```
 *
 * Lo que importa es `details[0].issue`. `name` sólo dice la familia
 * (`UNPROCESSABLE_ENTITY` cubre desde «tu banco dijo no» hasta «esta orden ya
 * se cobró») y `message` es prosa en inglés que no sirve para decidir nada.
 *
 * `debug_id` se conserva siempre: es el único dato con el que el soporte de
 * PayPal puede localizar la operación. Sin él hay que llamar por teléfono y
 * describir el caso — que es exactamente lo que hubo que hacer la vez que esto
 * se perdía.
 */

type Entry = {
  outcome: PaymentFailureOutcome;
  buyer: string;
  staff: string;
  retryable: boolean;
};

/**
 * Los `issue` que de verdad se ven en un checkout. La lista no pretende cubrir
 * el catálogo entero de PayPal: lo que no está aquí cae en «desconocido», que
 * se trata como pendiente y nunca como rechazo.
 */
const ISSUES: Record<string, Entry> = {
  // ── El banco dijo que no ────────────────────────────────────────────────
  INSTRUMENT_DECLINED: {
    outcome: "rejected",
    buyer:
      "Tu banco rechazó la tarjeta. Puedes intentar con otra o llamar a tu banco para autorizar el pago.",
    staff:
      "El banco o la procesadora rechazó el medio de pago (INSTRUMENT_DECLINED). No es un fallo nuestro.",
    // PayPal admite reintento con OTRO medio, no con el mismo.
    retryable: true,
  },
  PAYMENT_DENIED: {
    outcome: "rejected",
    buyer:
      "PayPal rechazó esta operación. Intenta con otro medio de pago o escríbenos y lo resolvemos.",
    staff: "PayPal denegó la transacción (PAYMENT_DENIED).",
    retryable: true,
  },
  TRANSACTION_REFUSED: {
    outcome: "rejected",
    buyer:
      "PayPal no pudo procesar el pago. Intenta con otro medio o escríbenos.",
    staff: "PayPal rechazó la petición (TRANSACTION_REFUSED).",
    retryable: true,
  },
  PAYER_CANNOT_PAY: {
    outcome: "rejected",
    buyer:
      "PayPal no permite completar este pago con esa cuenta. Prueba con otro medio de pago.",
    staff: "La cuenta del pagador no puede pagar esta operación (PAYER_CANNOT_PAY).",
    retryable: true,
  },

  // ── No se llegó a autorizar ─────────────────────────────────────────────
  CONTINGENCY_NOT_SUCCESSFUL: {
    outcome: "rejected",
    buyer:
      "Tu banco no pudo verificar la operación. Vuelve a intentarlo y completa la confirmación que te pida.",
    staff:
      "Falló la autenticación 3-D Secure (CONTINGENCY_NOT_SUCCESSFUL). La clienta no completó el reto del banco.",
    retryable: true,
  },
  PAYER_ACTION_REQUIRED: {
    outcome: "pending",
    buyer:
      "PayPal necesita que confirmes algo más para completar el pago. Vuelve a intentarlo desde el botón de pago.",
    staff:
      "PayPal pide una acción del pagador antes de capturar (PAYER_ACTION_REQUIRED).",
    retryable: true,
  },
  ORDER_NOT_APPROVED: {
    outcome: "rejected",
    buyer:
      "El pago no llegó a aprobarse en PayPal. Puedes intentarlo de nuevo cuando quieras.",
    staff:
      "La orden nunca fue aprobada por el pagador (ORDER_NOT_APPROVED): cerró la ventana de PayPal antes de confirmar.",
    retryable: true,
  },
  ORDER_EXPIRED: {
    outcome: "rejected",
    buyer:
      "La orden caducó porque pasó demasiado tiempo. Empieza el pago de nuevo.",
    staff: "La orden expiró antes de capturarse (ORDER_EXPIRED).",
    retryable: true,
  },

  /**
   * NO es un fallo. Significa que el dinero ya se cobró.
   *
   * Pasa de verdad: la clienta vuelve atrás y reintenta, o el retorno y el
   * webhook capturan casi a la vez. Tratarlo como error le diría «no se pudo
   * completar» a alguien a quien SÍ se le cobró — el peor mensaje posible.
   */
  ORDER_ALREADY_CAPTURED: {
    outcome: "succeeded",
    buyer: "Este pago ya estaba confirmado.",
    staff:
      "La orden ya estaba capturada (ORDER_ALREADY_CAPTURED). El pago existe; no hay nada que rescatar.",
    retryable: false,
  },

  // ── Cosas nuestras, no de la clienta ────────────────────────────────────
  PERMISSION_DENIED: {
    outcome: "rejected",
    buyer:
      "No pudimos procesar el pago por un problema de configuración. Escríbenos y lo resolvemos enseguida.",
    staff:
      "PayPal denegó el permiso (PERMISSION_DENIED). Revisar credenciales y permisos de la app.",
    retryable: false,
  },
  CURRENCY_NOT_SUPPORTED: {
    outcome: "rejected",
    buyer:
      "No pudimos procesar el pago en esa moneda. Escríbenos y te damos otra vía.",
    staff: "Moneda no admitida por la cuenta de PayPal (CURRENCY_NOT_SUPPORTED).",
    retryable: false,
  },
};

/** Familias por código HTTP, para cuando no hay `issue` reconocible. */
const byStatus = (status: number): Entry | null => {
  if (status === 401 || status === 403) {
    return {
      outcome: "rejected",
      buyer:
        "No pudimos procesar el pago por un problema de configuración. Escríbenos y lo resolvemos enseguida.",
      staff: `PayPal rechazó la autenticación (HTTP ${status}). Revisar credenciales.`,
      retryable: false,
    };
  }
  if (status === 404) {
    return {
      outcome: "rejected",
      buyer: "No encontramos esa orden de pago. Empieza de nuevo.",
      staff: "PayPal no encontró el recurso (HTTP 404).",
      retryable: true,
    };
  }
  if (status === 409) {
    return {
      outcome: "pending",
      buyer:
        "Tu pago se está procesando. En cuanto se confirme te llega el acceso.",
      staff: "Petición previa aún en curso en PayPal (HTTP 409).",
      retryable: true,
    };
  }
  if (status >= 500) {
    return {
      outcome: "pending",
      buyer:
        "PayPal está teniendo problemas en este momento. Inténtalo de nuevo en unos minutos.",
      staff: `Error del lado de PayPal (HTTP ${status}).`,
      retryable: true,
    };
  }
  return null;
};

type PayPalErrorBody = {
  name?: string;
  message?: string;
  debug_id?: string;
  details?: { issue?: string; description?: string }[];
};

export const parsePayPalError = (
  status: number,
  body: unknown
): PaymentFailure => {
  const parsed = (
    typeof body === "string" ? safeParse(body) : body
  ) as PayPalErrorBody | null;

  const debugId = parsed?.debug_id;
  const issue = parsed?.details?.find((d) => d.issue)?.issue;
  const entry = (issue ? ISSUES[issue] : undefined) ?? byStatus(status);

  if (!entry) {
    const fallback = unknownFailure(
      "PAYPAL",
      issue ?? parsed?.name ?? `HTTP ${status}`
    );
    return { ...fallback, rawCode: issue ?? parsed?.name, debugId };
  }

  return {
    outcome: entry.outcome,
    provider: "PAYPAL",
    code: issue ?? parsed?.name ?? `HTTP_${status}`,
    rawCode: issue ?? parsed?.name,
    debugId,
    buyerMessage: entry.buyer,
    // El debug_id va SIEMPRE en el mensaje del equipo: es lo que PayPal pide
    // para buscar la operación en su lado.
    staffMessage: debugId ? `${entry.staff} (debug_id: ${debugId})` : entry.staff,
    retryable: entry.retryable,
  };
};

const safeParse = (raw: string): unknown => {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

/**
 * Error de PayPal que conserva la respuesta en vez de aplastarla en texto.
 *
 * `lib/paypal/server.ts` lanzaba `new Error("PayPal capture failed (422): …")`,
 * y a partir de ahí el motivo real ya no existía para nadie.
 */
export class PayPalApiError extends Error {
  readonly status: number;
  readonly body: unknown;
  readonly failure: PaymentFailure;

  constructor(action: string, status: number, body: unknown) {
    const failure = parsePayPalError(status, body);
    super(`PayPal ${action} failed (${status}): ${failure.code}`);
    this.name = "PayPalApiError";
    this.status = status;
    this.body = body;
    this.failure = failure;
  }
}
