import crypto from "crypto";
import { getPayPalAccessToken } from "@/lib/paypal/server";

const isProduction = () =>
  process.env.NODE_ENV === "production" ||
  process.env.VERCEL_ENV === "production";

/** Mercado Pago x-signature (when MERCADOPAGO_WEBHOOK_SECRET is set). */
export const verifyMercadoPagoWebhook = (
  req: Request,
  rawBody: string
): boolean => {
  const secret = process.env.MERCADOPAGO_WEBHOOK_SECRET?.trim();
  if (!secret) {
    if (isProduction()) {
      console.error("[webhook mp] MERCADOPAGO_WEBHOOK_SECRET missing in production");
      return false;
    }
    return true;
  }

  const xSignature = req.headers.get("x-signature");
  const xRequestId = req.headers.get("x-request-id");
  if (!xSignature || !xRequestId) {
    console.warn("[webhook mp] missing signature headers");
    return false;
  }

  const parts = Object.fromEntries(
    xSignature.split(",").map((p) => {
      const [k, v] = p.split("=");
      return [k.trim(), v?.trim() ?? ""];
    })
  );
  const ts = parts.ts;
  const v1 = parts.v1;
  if (!ts || !v1) return false;

  const dataId =
    req.headers.get("x-data-id") ??
    (() => {
      try {
        const j = JSON.parse(rawBody) as { data?: { id?: string } };
        return j.data?.id != null ? String(j.data.id) : "";
      } catch {
        return "";
      }
    })();

  const manifest = `id:${dataId};request-id:${xRequestId};ts:${ts};`;
  const expected = crypto
    .createHmac("sha256", secret)
    .update(manifest)
    .digest("hex");

  try {
    return crypto.timingSafeEqual(Buffer.from(v1), Buffer.from(expected));
  } catch {
    return false;
  }
};

/** PayPal webhook via REST verify API. */
export const verifyPayPalWebhook = async (
  req: Request,
  rawBody: string
): Promise<boolean> => {
  const webhookId = process.env.PAYPAL_WEBHOOK_ID?.trim();
  if (!webhookId) {
    if (isProduction()) {
      console.error("[webhook paypal] PAYPAL_WEBHOOK_ID missing in production");
      return false;
    }
    return true;
  }

  const transmissionId = req.headers.get("paypal-transmission-id");
  const transmissionTime = req.headers.get("paypal-transmission-time");
  const certUrl = req.headers.get("paypal-cert-url");
  const authAlgo = req.headers.get("paypal-auth-algo");
  const transmissionSig = req.headers.get("paypal-transmission-sig");

  if (
    !transmissionId ||
    !transmissionTime ||
    !certUrl ||
    !authAlgo ||
    !transmissionSig
  ) {
    console.warn("[webhook paypal] missing transmission headers");
    return false;
  }

  let webhookEvent: unknown;
  try {
    webhookEvent = JSON.parse(rawBody);
  } catch {
    return false;
  }

  try {
    const accessToken = await getPayPalAccessToken();
    const mode = process.env.PAYPAL_MODE?.toLowerCase();
    const base =
      mode === "live"
        ? "https://api-m.paypal.com"
        : "https://api-m.sandbox.paypal.com";

    const res = await fetch(
      `${base}/v1/notifications/verify-webhook-signature`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          auth_algo: authAlgo,
          cert_url: certUrl,
          transmission_id: transmissionId,
          transmission_sig: transmissionSig,
          transmission_time: transmissionTime,
          webhook_id: webhookId,
          webhook_event: webhookEvent,
        }),
      }
    );

    if (!res.ok) {
      console.warn("[webhook paypal] verify API failed", res.status);
      return false;
    }

    const json = (await res.json()) as { verification_status?: string };
    return json.verification_status === "SUCCESS";
  } catch (e) {
    console.error("[webhook paypal] verify error", e);
    return false;
  }
};
