/**
 * Suscripciones de Mercado Pago (preapproval).
 *
 * MP no tiene SDK oficial mantenido para esto, así que se habla con su API REST
 * directamente — igual que hace `create-preference`.
 *
 * **El cobro recurrente sólo funciona con TARJETA.** Ni PSE, ni Nequi, ni
 * efectivo: MP necesita un medio que pueda debitar sin la clienta delante. Por
 * eso en Colombia la suscripción NO reemplaza al pago suelto, convive con él —
 * quitarlo dejaría fuera a buena parte de las compradoras.
 */

const API = "https://api.mercadopago.com";

const token = (): string => {
  const t = process.env.MERCADOPAGO_ACCESS_TOKEN?.trim();
  if (!t) throw new Error("Falta MERCADOPAGO_ACCESS_TOKEN");
  return t;
};

const call = async <T>(
  path: string,
  init?: { method?: string; body?: unknown }
): Promise<T> => {
  const res = await fetch(`${API}${path}`, {
    method: init?.method ?? "GET",
    headers: {
      Authorization: `Bearer ${token()}`,
      "Content-Type": "application/json",
    },
    ...(init?.body ? { body: JSON.stringify(init.body) } : {}),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(
      `${path} -> ${res.status}: ${JSON.stringify(json).slice(0, 300)}`
    );
  }
  return json as T;
};

export type PreapprovalPlan = {
  id: string;
  init_point?: string;
  status?: string;
  auto_recurring?: {
    transaction_amount?: number;
    currency_id?: string;
    frequency?: number;
    frequency_type?: string;
  };
};

/**
 * Crea el plan mensual. El importe ya lleva el gross-up de comisión, porque el
 * plan cobra una cifra fija.
 */
export const createPreapprovalPlan = async (input: {
  reason: string;
  amountCop: number;
  backUrl: string;
}): Promise<PreapprovalPlan> =>
  call<PreapprovalPlan>("/preapproval_plan", {
    method: "POST",
    body: {
      reason: input.reason.slice(0, 255),
      back_url: input.backUrl,
      auto_recurring: {
        frequency: 1,
        frequency_type: "months",
        // COP no tiene centavos: va en pesos enteros, la misma convención que
        // el resto del CRM (ver CLAUDE.md).
        transaction_amount: Math.round(input.amountCop),
        currency_id: "COP",
      },
      payment_methods_allowed: {
        // Sólo tarjeta: es lo único que MP puede debitar de forma recurrente.
        payment_types: [{ id: "credit_card" }, { id: "debit_card" }],
      },
    },
  });

export const getPreapprovalPlan = async (
  id: string
): Promise<PreapprovalPlan> => call<PreapprovalPlan>(`/preapproval_plan/${id}`);

/**
 * Cambia el importe del plan. Afecta a quien se suscriba a partir de ahora.
 *
 * Que alcance también a las suscripciones ya vivas **no está documentado** por
 * Mercado Pago, así que no se da por hecho: `updatePreapprovalAmount` las
 * recorre una a una. Al contrario que PayPal, donde el cambio del plan sí las
 * cubre por diseño.
 */
export const updatePreapprovalPlan = async (
  id: string,
  amountCop: number
): Promise<PreapprovalPlan> =>
  call<PreapprovalPlan>(`/preapproval_plan/${id}`, {
    method: "PUT",
    body: {
      auto_recurring: {
        transaction_amount: Math.round(amountCop),
        currency_id: "COP",
      },
    },
  });

/**
 * Cambia el importe de UNA suscripción viva.
 *
 * MP puede rechazarlo —es plausible que exija nueva autorización de la titular
 * cuando el importe sube—, y en ese caso esa persona sigue pagando el precio
 * anterior. No se puede forzar desde aquí, así que el fallo se propaga para que
 * el llamante lo haga visible en vez de tragárselo.
 */
export const updatePreapprovalAmount = async (
  id: string,
  amountCop: number
): Promise<void> => {
  await call(`/preapproval/${id}`, {
    method: "PUT",
    body: {
      auto_recurring: {
        transaction_amount: Math.round(amountCop),
        currency_id: "COP",
      },
    },
  });
};

/**
 * A dónde se manda a la compradora para que autorice el débito.
 *
 * Se usa el `init_point` del PLAN, no un `POST /preapproval`. Crear la
 * suscripción desde el servidor exige `card_token_id` —comprobado: MP responde
 * `400 card_token_id is required`—, o sea recoger la tarjeta nosotros. Con el
 * checkout del plan la recoge MP, que además es lo deseable: menos datos
 * sensibles pasando por aquí.
 *
 * La referencia del checkout viaja como `external_reference` en la query. Si MP
 * no la propagara, `syncPreapproval` cae al email del pagador para encontrar el
 * contacto — el alta no puede depender de un parámetro que no controlamos.
 */
export const planCheckoutUrl = (
  planInitPoint: string,
  checkoutReference: string
): string => {
  const sep = planInitPoint.includes("?") ? "&" : "?";
  return `${planInitPoint}${sep}external_reference=${encodeURIComponent(
    checkoutReference
  )}`;
};

export type Preapproval = {
  id: string;
  init_point?: string;
  status?: string;
  external_reference?: string;
  payer_email?: string;
  preapproval_plan_id?: string;
};

export const getPreapproval = async (id: string): Promise<Preapproval> =>
  call<Preapproval>(`/preapproval/${id}`);

export type AuthorizedPayment = {
  id?: number | string;
  preapproval_id?: string;
  status?: string;
  transaction_amount?: number;
  currency_id?: string;
  payment?: { id?: number | string; status?: string };
};

/** Un cobro concreto de la suscripción. */
export const getAuthorizedPayment = async (
  id: string
): Promise<AuthorizedPayment> =>
  call<AuthorizedPayment>(`/authorized_payments/${id}`);

/**
 * Detiene la renovación. NO recorta el acceso ya pagado: `paidUntil` manda, y
 * cerrar antes de esa fecha sería quedarse el dinero de un servicio no prestado.
 */
export const cancelPreapproval = async (id: string): Promise<void> => {
  await call(`/preapproval/${id}`, {
    method: "PUT",
    body: { status: "cancelled" },
  });
};
