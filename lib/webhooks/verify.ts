import crypto from "crypto";
import type { Webhooks } from "@mux/mux-node/resources/webhooks/webhooks";
import type StripeNamespace from "stripe";
type UnwrapWebhookEvent = Webhooks.UnwrapWebhookEvent;
type StripeEvent = StripeNamespace.Event;
import { getPayPalAccessToken } from "@/lib/paypal/server";
import { getMuxClient } from "@/lib/mux/client";

/** Local dev only — skip webhook signature verification. */
const isLocalDevelopment = () => process.env.NODE_ENV === "development";

const MP_SIGNATURE_MAX_AGE_MS = 5 * 60 * 1000;
/** Mercado Pago x-signature (when MERCADOPAGO_WEBHOOK_SECRET is set). */
export const verifyMercadoPagoWebhook = (
  req: Request,
  rawBody: string
): boolean => {
  const secret = process.env.MERCADOPAGO_WEBHOOK_SECRET?.trim();
  if (!secret) {
    if (!isLocalDevelopment()) {
      console.error("[webhook mp] MERCADOPAGO_WEBHOOK_SECRET missing");
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

  const tsMs = Number(ts) * 1000;
  if (!Number.isFinite(tsMs) || Date.now() - tsMs > MP_SIGNATURE_MAX_AGE_MS) {
    console.warn("[webhook mp] signature timestamp expired or invalid");
    return false;
  }

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
    const expectedBuf = Buffer.from(expected, "hex");
    const v1Buf = Buffer.from(v1, "hex");
    if (expectedBuf.length !== v1Buf.length) return false;
    return crypto.timingSafeEqual(v1Buf, expectedBuf);
  } catch {
    return false;
  }
};

/**
 * Meta webhook `X-Hub-Signature-256` (WhatsApp, Messenger e Instagram comparten
 * el mismo esquema y la misma app, así que un solo verificador cubre los tres).
 *
 * La firma es HMAC-SHA256 del cuerpo **crudo**: la ruta debe leer `req.text()`
 * una sola vez y parsear desde esa cadena. Volver a serializar el JSON cambia
 * los espacios y la firma deja de coincidir.
 */
export const verifyMetaWebhook = (req: Request, rawBody: string): boolean => {
  const secret = process.env.META_APP_SECRET?.trim();
  if (!secret) {
    if (!isLocalDevelopment()) {
      console.error("[webhook meta] META_APP_SECRET missing");
      return false;
    }
    return true;
  }

  const header = req.headers.get("x-hub-signature-256");
  if (!header) {
    console.warn("[webhook meta] missing x-hub-signature-256");
    return false;
  }

  const [algorithm, signature] = header.split("=");
  if (algorithm !== "sha256" || !signature) return false;

  const expected = crypto
    .createHmac("sha256", secret)
    .update(rawBody, "utf8")
    .digest("hex");

  try {
    const expectedBuf = Buffer.from(expected, "hex");
    const signatureBuf = Buffer.from(signature, "hex");
    if (expectedBuf.length !== signatureBuf.length) return false;
    return crypto.timingSafeEqual(signatureBuf, expectedBuf);
  } catch {
    return false;
  }
};

/**
 * Handshake de suscripción de Meta. Devuelve el `hub.challenge` a repetir, o
 * null si el token no coincide — la ruta responde 403 en ese caso.
 */
export const resolveMetaSubscription = (req: Request): string | null => {
  const url = new URL(req.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");

  const expected = process.env.META_WEBHOOK_VERIFY_TOKEN?.trim();
  if (!expected) {
    console.error("[webhook meta] META_WEBHOOK_VERIFY_TOKEN missing");
    return null;
  }
  if (mode !== "subscribe" || !challenge) return null;
  if (!token || token !== expected) {
    console.warn("[webhook meta] verify token mismatch");
    return null;
  }

  return challenge;
};

/**
 * Resend webhook (Svix scheme): `svix-id.svix-timestamp.rawBody` HMAC-SHA256
 * with the secret's base64 payload after the `whsec_` prefix, compared against
 * any of the space-separated `v1,<sig>` values in `svix-signature` (Svix
 * rotates/multi-signs during secret rollover, so more than one may be valid).
 */
export const verifyResendWebhook = (req: Request, rawBody: string): boolean => {
  const secret = process.env.RESEND_WEBHOOK_SECRET?.trim();
  if (!secret) {
    if (!isLocalDevelopment()) {
      console.error("[webhook resend] RESEND_WEBHOOK_SECRET missing");
      return false;
    }
    return true;
  }

  const svixId = req.headers.get("svix-id");
  const svixTimestamp = req.headers.get("svix-timestamp");
  const svixSignature = req.headers.get("svix-signature");
  if (!svixId || !svixTimestamp || !svixSignature) {
    console.warn("[webhook resend] missing svix headers");
    return false;
  }

  const secretBytes = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const signedContent = `${svixId}.${svixTimestamp}.${rawBody}`;
  const expected = crypto
    .createHmac("sha256", secretBytes)
    .update(signedContent, "utf8")
    .digest("base64");

  const candidates = svixSignature
    .split(" ")
    .map((p) => p.split(",")[1])
    .filter(Boolean);

  try {
    const expectedBuf = Buffer.from(expected, "base64");
    return candidates.some((sig) => {
      const sigBuf = Buffer.from(sig, "base64");
      return (
        sigBuf.length === expectedBuf.length &&
        crypto.timingSafeEqual(sigBuf, expectedBuf)
      );
    });
  } catch {
    return false;
  }
};

/**
 * Twilio `X-Twilio-Signature`: HMAC-SHA1, en base64, del token de autenticación
 * sobre la URL exacta que Twilio pidió más cada par nombre+valor del cuerpo,
 * concatenados en orden alfabético por nombre.
 *
 * Dos trampas:
 *
 * 1. La URL firmada es la que está configurada en la consola de Twilio, no la
 *    que llega al proceso. Detrás del proxy de Vercel el host de `req.url` puede
 *    ser el del deployment interno, así que se reconstruye desde `siteUrl()` (o
 *    TWILIO_WEBHOOK_BASE_URL) y solo se toman `pathname` y `search` de la
 *    petición. La barra final cuenta.
 * 2. Esto solo vale mientras el webhook esté configurado como
 *    `application/x-www-form-urlencoded` (el modo por defecto). En modo JSON
 *    Twilio firma `url + "?bodySHA256=..."` y este verificador rechazaría todo.
 *
 * A diferencia del resto del archivo, el bypass de desarrollo exige además que
 * no estemos en Vercel: la ruta no pasa por `proxy.ts` y lo que hay al otro lado
 * es el estado de baja de los contactos.
 */
export const verifyTwilioWebhook = (req: Request, rawBody: string): boolean => {
  const token = process.env.TWILIO_AUTH_TOKEN?.trim();
  if (!token) {
    if (!isLocalDevelopment() || process.env.VERCEL) {
      console.error("[webhook twilio] TWILIO_AUTH_TOKEN missing");
      return false;
    }
    return true;
  }

  const signature = req.headers.get("x-twilio-signature");
  if (!signature) {
    console.warn("[webhook twilio] missing x-twilio-signature");
    return false;
  }

  const base = (
    process.env.TWILIO_WEBHOOK_BASE_URL?.trim() ||
    process.env.NEXT_PUBLIC_SITE_URL?.trim() ||
    "http://localhost:3000"
  ).replace(/\/$/, "");
  const requested = new URL(req.url);
  const url = `${base}${requested.pathname}${requested.search}`;

  const params = new URLSearchParams(rawBody);
  const data = [...params.keys()]
    .sort()
    .reduce((acc, key) => `${acc}${key}${params.get(key) ?? ""}`, url);

  const expected = crypto
    .createHmac("sha1", token)
    .update(data, "utf8")
    .digest("base64");

  try {
    const expectedBuf = Buffer.from(expected, "base64");
    const signatureBuf = Buffer.from(signature, "base64");
    if (expectedBuf.length !== signatureBuf.length) return false;
    return crypto.timingSafeEqual(signatureBuf, expectedBuf);
  } catch {
    return false;
  }
};

/** PayPal webhook via REST verify API. */
/**
 * ¿Existe este `webhook_id` en la cuenta del entorno actual?
 *
 * Se consulta una sola vez por proceso: es una llamada de red y sólo importa
 * cuando ya falló la verificación.
 */
let webhookIdChecked = false;
const warnIfWebhookIdUnknown = async (webhookId: string): Promise<void> => {
  if (webhookIdChecked) return;
  webhookIdChecked = true;

  const mode = process.env.PAYPAL_MODE?.toLowerCase();
  const base =
    mode === "live"
      ? "https://api-m.paypal.com"
      : "https://api-m.sandbox.paypal.com";

  const accessToken = await getPayPalAccessToken();
  const res = await fetch(`${base}/v1/notifications/webhooks`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return;

  const json = (await res.json()) as {
    webhooks?: Array<{ id?: string; url?: string }>;
  };
  const registered = json.webhooks ?? [];
  if (registered.some((w) => w.id === webhookId)) return;

  console.error(
    `[webhook paypal] PAYPAL_WEBHOOK_ID="${webhookId}" NO existe en la cuenta ` +
      `${mode === "live" ? "live" : "sandbox"}. Toda verificación de firma va a ` +
      `fallar y ningún pago se registrará. Webhooks registrados: ` +
      (registered.map((w) => `${w.id} -> ${w.url}`).join(" | ") || "(ninguno)")
  );
};

export const verifyPayPalWebhook = async (
  req: Request,
  rawBody: string
): Promise<boolean> => {
  const webhookId = process.env.PAYPAL_WEBHOOK_ID?.trim();
  if (!webhookId) {
    if (!isLocalDevelopment()) {
      console.error("[webhook paypal] PAYPAL_WEBHOOK_ID missing");
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
    if (json.verification_status === "SUCCESS") return true;

    /**
     * FAILURE con cabeceras completas casi siempre significa que
     * `PAYPAL_WEBHOOK_ID` no corresponde al webhook que envió el aviso —
     * normalmente el id de otro entorno, o uno que ya no existe en la cuenta.
     *
     * Pasó en producción y costó caro: un id inexistente hace que PayPal
     * responda FAILURE a TODO, la ruta devuelve 401 y ningún pago se registra,
     * mientras el panel de PayPal muestra entregas fallidas sin explicar por
     * qué. Como el fallo es indistinguible de una firma falsa, se comprueba una
     * vez si el id existe siquiera en esta cuenta y se dice en el log.
     */
    await warnIfWebhookIdUnknown(webhookId).catch(() => undefined);
    return false;
  } catch (e) {
    console.error("[webhook paypal] verify error", e);
    return false;
  }
};

/**
 * Mux webhook signature + parse in one call, via the official SDK
 * (`mux.webhooks.unwrap`) instead of hand-rolled HMAC like the other
 * verifiers here — Mux's signature scheme (timestamped, versioned) is
 * SDK-maintained rather than a stable-enough contract to reimplement.
 * Same raw-body discipline as the rest of this file: the route reads
 * `req.text()` once and this function verifies over those exact bytes.
 */
export const verifyAndParseMuxWebhook = async (
  req: Request,
  rawBody: string
): Promise<UnwrapWebhookEvent | null> => {
  const secret = process.env.MUX_WEBHOOK_SECRET?.trim();
  if (!secret) {
    console.error("[webhook mux] MUX_WEBHOOK_SECRET missing");
    return null;
  }

  try {
    const mux = getMuxClient();
    return await mux.webhooks.unwrap(rawBody, req.headers, secret);
  } catch (e) {
    console.warn("[webhook mux] signature verification failed", e);
    return null;
  }
};

/**
 * Lemon Squeezy `X-Signature`: HMAC-SHA256 **hex** sobre el cuerpo crudo.
 *
 * Sin timestamp ni versión — más simple que Mercado Pago, y por eso mismo sin
 * protección de replay propia; la idempotencia la pone `registerWebhookEvent`
 * con el id sintético del evento. Misma disciplina de raw body que el resto
 * del archivo: la ruta lee `req.text()` una sola vez y esto verifica sobre
 * esos bytes exactos.
 */
export const verifyLemonSqueezyWebhook = (
  req: Request,
  rawBody: string
): boolean => {
  const secret = process.env.LEMONSQUEEZY_WEBHOOK_SECRET?.trim();
  if (!secret) {
    if (!isLocalDevelopment()) {
      console.error("[webhook ls] LEMONSQUEEZY_WEBHOOK_SECRET missing");
      return false;
    }
    return true;
  }

  const signature = req.headers.get("x-signature");
  if (!signature) {
    console.warn("[webhook ls] missing x-signature header");
    return false;
  }

  const expected = crypto
    .createHmac("sha256", secret)
    .update(rawBody)
    .digest("hex");

  try {
    const expectedBuf = Buffer.from(expected, "hex");
    const givenBuf = Buffer.from(signature.trim(), "hex");
    if (expectedBuf.length !== givenBuf.length) return false;
    return crypto.timingSafeEqual(givenBuf, expectedBuf);
  } catch {
    return false;
  }
};

/**
 * Stripe `Stripe-Signature` (timestamped HMAC-SHA256 over `t.rawBody`).
 * Delegated to the SDK like Mux: the scheme is versioned and includes replay
 * protection Stripe tunes on its side.
 *
 * Same raw-body discipline as the rest of this file — the route reads
 * `req.text()` exactly once and this verifies over those bytes. Re-serializing
 * the parsed JSON changes them and the signature stops matching.
 */
export const verifyAndParseStripeWebhook = async (
  req: Request,
  rawBody: string
): Promise<StripeEvent | null> => {
  const secret = process.env.STRIPE_WEBHOOK_SECRET?.trim();
  if (!secret) {
    if (!isLocalDevelopment()) {
      console.error("[webhook stripe] STRIPE_WEBHOOK_SECRET missing");
      return null;
    }
    try {
      return JSON.parse(rawBody) as StripeEvent;
    } catch {
      return null;
    }
  }

  const signature = req.headers.get("stripe-signature");
  if (!signature) {
    console.warn("[webhook stripe] missing stripe-signature header");
    return null;
  }

  try {
    const { getStripe } = await import("@/lib/payments/stripe/client");
    return getStripe().webhooks.constructEvent(rawBody, signature, secret);
  } catch (e) {
    console.warn("[webhook stripe] signature verification failed", e);
    return null;
  }
};
