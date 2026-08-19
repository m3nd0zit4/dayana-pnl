import crypto from "crypto";
import { PrismaClient } from "@prisma/client";

/**
 * Utilidades del suite de pagos.
 *
 * Cliente Prisma propio (no el singleton de `lib/db.ts`) para que el proceso de
 * Playwright abra y cierre su propia conexión sin interferir con el servidor.
 */
export const db = new PrismaClient();

/** Marca con la que se reconocen y limpian los datos de este suite. */
export const TEST_EMAIL_DOMAIN = "e2e-pagos.test";
export const testEmail = (slug: string) => `${slug}@${TEST_EMAIL_DOMAIN}`;

// ── ids de proveedor irrepetibles por corrida ────────────────────────────────
const runId = Date.now().toString().slice(-8);
let seq = 0;
export const nextProviderId = (prefix: string) =>
  `${prefix}-${runId}-${++seq}`;

/**
 * IP distinta por petición.
 *
 * Las rutas de checkout limitan a 30 peticiones/60s por IP (`clientIp` lee
 * `x-forwarded-for`). Con el suite entero saliendo de 127.0.0.1 se agota la
 * cuota a mitad de la corrida y fallan tests que no tienen nada roto. Cada
 * prueba es una visitante distinta, así que darle su propia IP es además lo
 * fiel a la realidad — y no toca el código de producción.
 */
let ipSeq = 0;
export const nextIp = () => {
  ipSeq += 1;
  return `203.0.113.${(ipSeq % 250) + 1}`;
};

// ── creación de checkout (lo que hace el modal) ──────────────────────────────

export type CheckoutResult = {
  status: number;
  contactId?: string;
  checkoutReference?: string;
  approveUrl?: string;
  init_point?: string;
  amountValue?: string;
  error?: string;
};

export const createCheckout = async (
  baseURL: string,
  provider: "paypal" | "mercadopago",
  planId: string,
  extra: Record<string, unknown> = {}
): Promise<CheckoutResult> => {
  const path =
    provider === "paypal"
      ? "/api/paypal/create-order"
      : "/api/mercadopago/create-preference";
  const res = await fetch(`${baseURL}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-forwarded-for": nextIp(),
    },
    body: JSON.stringify({
      planId,
      ...(provider === "mercadopago" ? { mode: "full" } : {}),
      ...extra,
    }),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: res.status, ...(json as object) } as CheckoutResult;
};

// ── webhooks ─────────────────────────────────────────────────────────────────

/**
 * Webhook de Mercado Pago con firma HMAC REAL.
 *
 * MP firma un manifiesto (`id:…;request-id:…;ts:…;`), no el cuerpo — ver
 * `verifyMercadoPagoWebhook`. Por eso hay que construirlo igual aquí.
 */
export const postMercadoPagoWebhook = async (
  baseURL: string,
  paymentId: string,
  opts: { validSignature?: boolean } = {}
) => {
  const secret = process.env.MERCADOPAGO_WEBHOOK_SECRET ?? "";
  const requestId = `e2e-${Date.now()}`;
  const ts = Math.floor(Date.now() / 1000).toString();
  const manifest = `id:${paymentId};request-id:${requestId};ts:${ts};`;
  const v1 =
    opts.validSignature === false
      ? "00".repeat(32)
      : crypto.createHmac("sha256", secret).update(manifest).digest("hex");

  const res = await fetch(`${baseURL}/api/webhooks/mercadopago`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-signature": `ts=${ts},v1=${v1}`,
      "x-request-id": requestId,
      "x-data-id": paymentId,
      "x-forwarded-for": nextIp(),
    },
    body: JSON.stringify({
      id: Number(runId),
      type: "payment",
      action: "payment.updated",
      data: { id: paymentId },
    }),
  });
  return { status: res.status, body: await res.text() };
};

/**
 * Webhook de PayPal. La firma la verifica PayPal contra su API, así que en
 * local se apoya en el bypass de desarrollo (ver la nota de
 * `playwright.payments.config.ts`).
 *
 * `shape` decide el cuerpo:
 *  - `order`: el de `CHECKOUT.ORDER.COMPLETED` (con purchase_units + captures)
 *  - `capture`: el de `PAYMENT.CAPTURE.*` (el recurso ES el capture)
 */
export const postPayPalWebhook = async (
  baseURL: string,
  input: {
    eventType: string;
    reference: string;
    captureId: string;
    status?: string;
    amount?: string;
    shape: "order" | "capture" | "refund";
    /** Fuerza el id del sobre, para reintentar el MISMO evento. */
    eventId?: string;
    payerEmail?: string;
    payerFirst?: string;
    payerLast?: string;
  }
) => {
  const {
    eventType,
    reference,
    captureId,
    status = "COMPLETED",
    amount = "84.88",
    shape,
    eventId,
    payerEmail,
    payerFirst,
    payerLast,
  } = input;

  const payer = payerEmail
    ? {
        email_address: payerEmail,
        name: { given_name: payerFirst, surname: payerLast },
      }
    : undefined;

  const resource =
    shape === "order"
      ? {
          id: `ORDER-${captureId}`,
          status,
          purchase_units: [
            {
              reference_id: reference,
              custom_id: reference,
              payments: {
                captures: [
                  {
                    id: captureId,
                    status,
                    amount: { currency_code: "USD", value: amount },
                  },
                ],
              },
            },
          ],
          payer,
        }
      : shape === "refund"
        ? {
            // Shape real de PAYMENT.CAPTURE.REFUNDED: el recurso es el REFUND,
            // con id propio. El capture original sólo aparece en links[rel=up].
            id: `REFUND-${captureId}`,
            status: "COMPLETED",
            custom_id: reference,
            amount: { currency_code: "USD", value: amount },
            links: [
              {
                rel: "up",
                href: `https://api.paypal.com/v2/payments/captures/${captureId}`,
                method: "GET",
              },
            ],
            payer,
          }
        : {
            // Shape real de PAYMENT.CAPTURE.*: el recurso es el capture.
            id: captureId,
            status,
            custom_id: reference,
            amount: { currency_code: "USD", value: amount },
            payer,
          };

  const res = await fetch(`${baseURL}/api/webhooks/paypal`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-forwarded-for": nextIp(),
    },
    body: JSON.stringify({
      // El id del SOBRE debe cambiar por evento: `registerWebhookEvent` dedupe
      // por él, y reusarlo hacía que el reembolso se descartara como repetido
      // del cobro.
      id: eventId ?? `WH-${eventType}-${captureId}`,
      event_type: eventType,
      resource_type: shape === "order" ? "checkout-order" : "capture",
      resource,
    }),
  });
  return { status: res.status, body: await res.text() };
};

// ── consultas al CRM ─────────────────────────────────────────────────────────

export const paymentsFor = (providerPaymentId: string) =>
  db.payment.findMany({ where: { providerPaymentId } });

export const enrollmentOf = async (contactId: string, productId: string) =>
  db.enrollment.findFirst({
    where: { contactId, productId },
    orderBy: { createdAt: "desc" },
    include: { payments: true },
  });

export const contactById = (id: string) =>
  db.contact.findUnique({ where: { id } });

// ── limpieza ─────────────────────────────────────────────────────────────────

/**
 * Borra sólo lo que crea este suite: contactos temporales (`+pending`) y los
 * que llevan el dominio de prueba. Las matrículas y pagos caen en cascada.
 */
export const cleanupTestData = async () => {
  const { count } = await db.contact.deleteMany({
    where: {
      OR: [
        { phoneE164: { startsWith: "+pending" } },
        { email: { endsWith: `@${TEST_EMAIL_DOMAIN}` } },
      ],
    },
  });
  return count;
};
