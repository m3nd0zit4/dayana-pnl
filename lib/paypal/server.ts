/**
 * PayPal REST v2 (server). Amount and plan always come from `getPlan` — never from the client.
 */

const apiBase = (): string => {
  const mode = process.env.PAYPAL_MODE?.toLowerCase();
  if (mode === "live") return "https://api-m.paypal.com";
  return "https://api-m.sandbox.paypal.com";
};

export const getPayPalAccessToken = async (): Promise<string> => {
  const clientId = process.env.PAYPAL_CLIENT_ID;
  const secret = process.env.PAYPAL_CLIENT_SECRET;
  if (!clientId || !secret) {
    throw new Error(
      "Missing PAYPAL_CLIENT_ID or PAYPAL_CLIENT_SECRET. Set them in .env."
    );
  }
  const auth = Buffer.from(`${clientId}:${secret}`).toString("base64");
  const res = await fetch(`${apiBase()}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`PayPal OAuth failed (${res.status}): ${text.slice(0, 200)}`);
  }
  const json = (await res.json()) as { access_token?: string };
  if (!json.access_token) throw new Error("PayPal OAuth: no access_token");
  return json.access_token;
};

type CreateOrderInput = {
  accessToken: string;
  planId: string;
  /** Checkout reference (contact + plan) stored in PayPal custom_id / MP external_reference */
  checkoutReference: string;
  planTitle: string;
  sessions: string;
  amountValue: string;
  currencyCode: string;
  /** Subtotal (precio neto del plan) en formato "0.00". Si está, se envía breakdown. */
  itemTotalValue?: string;
  /** Comisión que paga el cliente en formato "0.00". */
  handlingValue?: string;
  /** Flujo por redirección: a dónde vuelve PayPal tras aprobar / cancelar. */
  returnUrl?: string;
  cancelUrl?: string;
};

export const createPayPalOrderRequest = async (
  input: CreateOrderInput
): Promise<{ id: string; approveUrl?: string }> => {
  const hasBreakdown =
    typeof input.itemTotalValue === "string" &&
    typeof input.handlingValue === "string";

  const purchaseUnit: Record<string, unknown> = {
    reference_id: input.checkoutReference.slice(0, 256),
    description: `${input.planTitle} — ${input.sessions}`.slice(0, 127),
    custom_id: input.checkoutReference.slice(0, 127),
    amount: hasBreakdown
      ? {
          currency_code: input.currencyCode,
          value: input.amountValue,
          breakdown: {
            item_total: {
              currency_code: input.currencyCode,
              value: input.itemTotalValue,
            },
            handling: {
              currency_code: input.currencyCode,
              value: input.handlingValue,
            },
          },
        }
      : {
          currency_code: input.currencyCode,
          value: input.amountValue,
        },
  };

  if (hasBreakdown) {
    purchaseUnit.items = [
      {
        name: `${input.planTitle} — ${input.sessions}`.slice(0, 127),
        quantity: "1",
        category: "DIGITAL_GOODS",
        unit_amount: {
          currency_code: input.currencyCode,
          value: input.itemTotalValue,
        },
      },
    ];
  }

  const res = await fetch(`${apiBase()}/v2/checkout/orders`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.accessToken}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify({
      intent: "CAPTURE",
      purchase_units: [purchaseUnit],
      /**
       * `experience_context` dentro de `payment_source.paypal`, NO
       * `application_context`.
       *
       * `application_context` está deprecado en Orders v2 y PayPal ya no lo
       * devuelve al consultar la orden; comprobado contra la API: una orden
       * creada con `experience_context` sí respeta `brand_name` y
       * `cancel_url` (aparece "Cancelar y volver a Dayana Beltran PNL" en su
       * pantalla), y con el campo viejo no.
       */
      payment_source: {
        paypal: {
          experience_context: {
            shipping_preference: "NO_SHIPPING",
            user_action: "PAY_NOW",
            brand_name: "Dayana Beltran PNL",
            /**
             * Aterriza en el formulario de TARJETA, no en el login.
             *
             * Por defecto PayPal manda al acceso, y quien no tiene cuenta se
             * da la vuelta: es la queja que llegaba de las clientas.
             *
             * No basta por sí solo — hace falta además "Pago como usuario no
             * registrado" ACTIVADO en la cuenta de negocio (Configuración →
             * Preferencias del sitio web). Con eso apagado PayPal ignora esto
             * y enseña el login igual.
             */
            landing_page: "GUEST_CHECKOUT",
            // Sin `locale` fijo: este rail atiende a TODO EL MUNDO MENOS
            // Colombia (las colombianas van por Mercado Pago), así que forzar
            // `es-CO` le daba castellano de Colombia a compradoras de México,
            // España o EE.UU. y condicionaba los medios que PayPal ofrece a
            // ese mercado. Sin el campo, lo resuelve desde la compradora.
            ...(input.returnUrl ? { return_url: input.returnUrl } : {}),
            ...(input.cancelUrl ? { cancel_url: input.cancelUrl } : {}),
          },
        },
      },
    }),
  });

  const json = (await res.json()) as {
    id?: string;
    message?: string;
    links?: Array<{ rel?: string; href?: string }>;
  };
  if (!res.ok || !json.id) {
    const msg =
      json.message ??
      (typeof json === "object" ? JSON.stringify(json).slice(0, 300) : "unknown");
    throw new Error(`PayPal create order failed (${res.status}): ${msg}`);
  }
  /**
   * URL a la que se manda a la compradora en el flujo por redirección.
   *
   * Con `application_context` PayPal la llamaba `approve`; con
   * `experience_context` la llama `payer-action`. Se aceptan las dos: leer
   * sólo la primera dejaba el botón sin destino y el checkout muerto.
   */
  const approveUrl = json.links?.find(
    (l) => l.rel === "payer-action" || l.rel === "approve"
  )?.href;
  return { id: json.id, approveUrl };
};

export const capturePayPalOrderRequest = async (
  accessToken: string,
  orderId: string
): Promise<unknown> => {
  const res = await fetch(`${apiBase()}/v2/checkout/orders/${orderId}/capture`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
  });
  const json = await res.json();
  if (!res.ok) {
    const msg =
      typeof json === "object" && json !== null && "message" in json
        ? String((json as { message: string }).message)
        : JSON.stringify(json).slice(0, 300);
    throw new Error(`PayPal capture failed (${res.status}): ${msg}`);
  }
  return json;
};
