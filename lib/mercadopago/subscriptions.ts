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

export type PreapprovalPlan = { id: string; init_point?: string };

/** Crea el plan mensual. El importe ya lleva el gross-up de comisión. */
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
        // COP no tiene centavos: `transaction_amount` va en pesos enteros, la
        // misma convención que el resto del CRM (ver CLAUDE.md).
        transaction_amount: Math.round(input.amountCop),
        currency_id: "COP",
      },
      payment_methods_allowed: {
        // Sólo tarjeta: es lo único que MP puede debitar de forma recurrente.
        payment_types: [{ id: "credit_card" }, { id: "debit_card" }],
      },
    },
  });

export type Preapproval = {
  id: string;
  init_point?: string;
  status?: string;
  external_reference?: string;
  payer_email?: string;
  preapproval_plan_id?: string;
};

/**
 * Alta de la suscripción sobre un plan. Devuelve el `init_point` al que se
 * manda a la compradora para que autorice el débito.
 */
export const createPreapproval = async (input: {
  planId: string;
  checkoutReference: string;
  backUrl: string;
  payerEmail?: string;
}): Promise<Preapproval> =>
  call<Preapproval>("/preapproval", {
    method: "POST",
    body: {
      preapproval_plan_id: input.planId,
      external_reference: input.checkoutReference,
      back_url: input.backUrl,
      ...(input.payerEmail ? { payer_email: input.payerEmail } : {}),
    },
  });

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
