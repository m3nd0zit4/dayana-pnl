/**
 * Billing Plans de PayPal: crear, leer y **cambiar el precio en vivo**.
 *
 * Vive aparte de `lib/paypal/subscriptions.ts` porque aquello opera sobre
 * suscripciones de una clienta concreta (con el SDK) y esto sobre el catálogo
 * de planes. El SDK no cubre `/v1/billing/plans`, así que aquí se habla REST a
 * mano — el mismo trato que `lib/paypal/server.ts` da a las órdenes.
 *
 * ## Lo importante de `update-pricing-schemes`
 *
 * Cambiar el precio de un plan **alcanza también a las suscripciones ya vivas**.
 * Del spec de PayPal: «The changes to fixed amount are applicable to both
 * existing and future subscriptions. For existing subscriptions, payments
 * within 10 days of price change are not affected.»
 *
 * Esa ventana de 10 días es la razón de que un cobro pueda llegar con el precio
 * anterior y ser perfectamente correcto — ver
 * `lib/crm/subscription-payment-validation.ts`.
 *
 * PayPal rechaza con 422 `PRICING_SCHEME_INVALID_AMOUNT` si se manda el mismo
 * importe que ya tiene. Quien llame debe haber comprobado que hay cambio.
 */

const apiBase = () =>
  process.env.PAYPAL_MODE?.toLowerCase() === "live"
    ? "https://api-m.paypal.com"
    : "https://api-m.sandbox.paypal.com";

/**
 * Token de aplicación. No se cachea a propósito: estas llamadas son de
 * administración —un cambio de precio, una corrida de script— y no están en
 * ningún camino caliente, así que un token por llamada sale gratis y evita
 * tener que invalidar caché cuando cambia `PAYPAL_MODE`.
 */
const accessToken = async (): Promise<string> => {
  const id = process.env.PAYPAL_CLIENT_ID;
  const secret = process.env.PAYPAL_CLIENT_SECRET;
  if (!id || !secret) throw new Error("PAYPAL_CLIENT_ID/SECRET no configurados");

  const res = await fetch(`${apiBase()}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  const json = (await res.json()) as { access_token?: string };
  if (!res.ok || !json.access_token) {
    throw new Error(`PayPal OAuth -> ${res.status}`);
  }
  return json.access_token;
};

export const paypalRestCall = async <T = Record<string, unknown>>(
  path: string,
  init: { method?: "GET" | "POST" | "PATCH"; body?: unknown } = {}
): Promise<T> => {
  const method = init.method ?? (init.body ? "POST" : "GET");
  const res = await fetch(`${apiBase()}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${await accessToken()}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    ...(init.body ? { body: JSON.stringify(init.body) } : {}),
  });

  // 204 es la respuesta normal de update-pricing-schemes y del PATCH de
  // suscripción: no hay cuerpo que parsear.
  if (res.status === 204) return undefined as T;

  const text = await res.text();
  const json = text ? JSON.parse(text) : {};
  if (!res.ok) {
    throw new Error(
      `${method} ${path} -> ${res.status}: ${JSON.stringify(json).slice(0, 400)}`
    );
  }
  return json as T;
};

export type PayPalBillingPlan = {
  id: string;
  status?: string;
  billing_cycles?: {
    sequence?: number;
    tenure_type?: string;
    pricing_scheme?: {
      fixed_price?: { value: string; currency_code: string };
    };
  }[];
};

export const getBillingPlan = (planId: string): Promise<PayPalBillingPlan> =>
  paypalRestCall<PayPalBillingPlan>(`/v1/billing/plans/${planId}`);

/** El importe que cobra hoy el ciclo regular del plan, en centavos. */
export const billingPlanGrossMinor = (plan: PayPalBillingPlan): number | null => {
  const regular =
    plan.billing_cycles?.find((c) => c.tenure_type === "REGULAR") ??
    plan.billing_cycles?.[0];
  const value = regular?.pricing_scheme?.fixed_price?.value;
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) : null;
};

export const createPayPalCatalogProduct = async (input: {
  title: string;
  description?: string | null;
}): Promise<string> => {
  const created = await paypalRestCall<{ id: string }>("/v1/catalogs/products", {
    body: {
      name: input.title.slice(0, 127),
      description: (input.description ?? input.title).slice(0, 256),
      type: "SERVICE",
      category: "EDUCATIONAL_AND_TEXTBOOKS",
    },
  });
  return created.id;
};

export const createBillingPlan = async (input: {
  paypalProductId: string;
  title: string;
  grossUsd: number;
}): Promise<{ id: string }> =>
  paypalRestCall<{ id: string }>("/v1/billing/plans", {
    body: {
      product_id: input.paypalProductId,
      name: `${input.title} — mensual`.slice(0, 127),
      description:
        `Acceso mensual. ${input.grossUsd.toFixed(2)} USD incluye la comisión de procesamiento.`.slice(
          0,
          127
        ),
      status: "ACTIVE",
      billing_cycles: [
        {
          frequency: { interval_unit: "MONTH", interval_count: 1 },
          tenure_type: "REGULAR",
          sequence: 1,
          // 0 = sin fin. La suscripción vive hasta que se cancele.
          total_cycles: 0,
          pricing_scheme: {
            fixed_price: {
              value: input.grossUsd.toFixed(2),
              currency_code: "USD",
            },
          },
        },
      ],
      payment_preferences: {
        auto_bill_outstanding: true,
        setup_fee_failure_action: "CONTINUE",
        // Tras 3 intentos fallidos PayPal suspende. El acceso NO se corta aquí:
        // lo decide `paidUntil` al vencer.
        payment_failure_threshold: 3,
      },
    },
  });

/**
 * Cambia el precio del ciclo regular. Alcanza a las suscripciones vivas — ver
 * la nota de arriba sobre la ventana de 10 días.
 */
export const updateBillingPlanPricing = async (
  planId: string,
  grossUsd: number,
  billingCycleSequence = 1
): Promise<void> => {
  await paypalRestCall(`/v1/billing/plans/${planId}/update-pricing-schemes`, {
    body: {
      pricing_schemes: [
        {
          billing_cycle_sequence: billingCycleSequence,
          pricing_scheme: {
            fixed_price: { value: grossUsd.toFixed(2), currency_code: "USD" },
          },
        },
      ],
    },
  });
};
