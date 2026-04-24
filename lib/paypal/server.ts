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
      "Missing PAYPAL_CLIENT_ID or PAYPAL_CLIENT_SECRET. Set them in .env.local."
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
  planTitle: string;
  sessions: string;
  amountValue: string;
  currencyCode: string;
};

export const createPayPalOrderRequest = async (
  input: CreateOrderInput
): Promise<{ id: string }> => {
  const res = await fetch(`${apiBase()}/v2/checkout/orders`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.accessToken}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify({
      intent: "CAPTURE",
      purchase_units: [
        {
          reference_id: input.planId.slice(0, 256),
          description: `${input.planTitle} — ${input.sessions}`.slice(0, 127),
          custom_id: input.planId.slice(0, 127),
          amount: {
            currency_code: input.currencyCode,
            value: input.amountValue,
          },
        },
      ],
      application_context: {
        shipping_preference: "NO_SHIPPING",
        user_action: "PAY_NOW",
      },
    }),
  });

  const json = (await res.json()) as { id?: string; message?: string };
  if (!res.ok || !json.id) {
    const msg =
      json.message ??
      (typeof json === "object" ? JSON.stringify(json).slice(0, 300) : "unknown");
    throw new Error(`PayPal create order failed (${res.status}): ${msg}`);
  }
  return { id: json.id };
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
