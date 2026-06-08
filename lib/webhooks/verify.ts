import crypto from "crypto";

/** Mercado Pago x-signature (when MERCADOPAGO_WEBHOOK_SECRET is set). */
export const verifyMercadoPagoWebhook = (
  req: Request,
  rawBody: string
): boolean => {
  const secret = process.env.MERCADOPAGO_WEBHOOK_SECRET?.trim();
  if (!secret) return true;

  const xSignature = req.headers.get("x-signature");
  const xRequestId = req.headers.get("x-request-id");
  if (!xSignature || !xRequestId) return false;

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

/** PayPal transmission verify (requires PAYPAL_WEBHOOK_ID + cert id from headers). */
export const verifyPayPalWebhookHeaders = (req: Request): boolean => {
  const webhookId = process.env.PAYPAL_WEBHOOK_ID?.trim();
  if (!webhookId) return true;

  const transmissionId = req.headers.get("paypal-transmission-id");
  const transmissionTime = req.headers.get("paypal-transmission-time");
  const certUrl = req.headers.get("paypal-cert-url");
  const authAlgo = req.headers.get("paypal-auth-algo");
  const transmissionSig = req.headers.get("paypal-transmission-sig");

  if (!transmissionId || !transmissionTime || !certUrl || !authAlgo || !transmissionSig) {
    return false;
  }

  // Full cert verification needs PayPal SDK; require headers when webhook id is set.
  return true;
};
