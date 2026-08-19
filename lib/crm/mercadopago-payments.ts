import { EnrollmentStatus, PaymentProvider, PaymentStatus } from "@prisma/client";
import { prisma } from "../db";
import {
  findEnrollmentForCheckout,
  fulfillCheckoutPayment,
} from "./checkout-fulfillment";
import { createEnrollment } from "./enrollments";
import { parseCheckoutReference } from "./checkout-reference";
import { recordPayment, resolveEnrollmentFromReference } from "./payments";
import { reconcilePendingCheckoutContact } from "./checkout-placeholder";

export type MercadoPagoApiPayment = {
  id?: number;
  status?: string;
  external_reference?: string;
  transaction_amount?: number;
  currency_id?: string;
  payer?: {
    email?: string;
    first_name?: string;
    last_name?: string;
    /**
     * Mercado Pago sí entrega el teléfono del pagador — antes se descartaba.
     * Viene partido en prefijo y número, y cualquiera de los dos puede faltar.
     */
    phone?: { area_code?: string; number?: string };
    identification?: { type?: string; number?: string };
    address?: { country?: string };
  };
};

/**
 * Une prefijo y número tal como los manda Mercado Pago, sin normalizar: de eso
 * se encarga `lib/phone.ts` en el punto de escritura.
 */
const mercadoPagoPayerPhone = (
  payer: MercadoPagoApiPayment["payer"]
): string | undefined => {
  const area = payer?.phone?.area_code?.trim() ?? "";
  const number = payer?.phone?.number?.trim() ?? "";
  const joined = `${area}${number}`.trim();
  return joined || undefined;
};

const getAccessToken = () => process.env.MERCADOPAGO_ACCESS_TOKEN?.trim();

/**
 * COP prices are stored as whole pesos everywhere else in the CRM
 * (Product/ProductPrice, portal, admin) — only USD uses cents. Mercado
 * Pago's API always returns `transaction_amount` in the currency's major
 * unit, so COP must NOT be multiplied by 100 like USD is.
 */
const toAmountMinor = (amount: number, currency: string): number =>
  currency === "COP" ? Math.round(amount) : Math.round(amount * 100);

export const fetchMercadoPagoPayment = async (
  paymentId: string
): Promise<MercadoPagoApiPayment | null> => {
  const token = getAccessToken();
  if (!token) return null;

  const res = await fetch(
    `https://api.mercadopago.com/v1/payments/${paymentId}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!res.ok) return null;
  return (await res.json()) as MercadoPagoApiPayment;
};

export type SyncMercadoPagoResult =
  | { outcome: "recorded"; enrollmentId: string }
  | { outcome: "skipped"; reason: string };

/**
 * Fetches a Mercado Pago payment by id and records it (Payment row +
 * enrollment) in the CRM. Idempotent per `provider_providerPaymentId` — safe
 * to call from both the webhook AND the checkout-return page, so payment
 * registration does not depend solely on the webhook arriving (misconfigured
 * or delayed notification_url, dashboard webhook not set up, etc.).
 */
export const syncMercadoPagoPayment = async (
  paymentId: string
): Promise<SyncMercadoPagoResult> => {
  /**
   * Atajo para la reconciliación desde `/pago/exito`: si el pago ya está
   * registrado, ahorra la llamada a la API de Mercado Pago.
   *
   * Sólo vale para estados FINALES. Un PENDING (PSE, efectivo) es justo el
   * caso que espera un segundo aviso con `approved`: cortar aquí lo dejaría
   * pendiente para siempre y la clienta pagaría sin recibir acceso.
   */
  const existing = await prisma.payment.findUnique({
    where: {
      provider_providerPaymentId: {
        provider: PaymentProvider.MERCADO_PAGO,
        providerPaymentId: paymentId,
      },
    },
    select: { enrollmentId: true, status: true },
  });
  if (
    existing &&
    (existing.status === PaymentStatus.APPROVED ||
      existing.status === PaymentStatus.REFUNDED)
  ) {
    return { outcome: "recorded", enrollmentId: existing.enrollmentId };
  }

  const payment = await fetchMercadoPagoPayment(paymentId);
  if (!payment?.external_reference) {
    return { outcome: "skipped", reason: "no_reference" };
  }

  const mpStatus = payment.status ?? "";
  const approved = mpStatus === "approved";
  const failed =
    mpStatus === "rejected" ||
    mpStatus === "cancelled" ||
    mpStatus === "charged_back";
  const currency = (payment.currency_id ?? "USD").toUpperCase();
  const amountMinor = toAmountMinor(payment.transaction_amount ?? 0, currency);
  const providerPaymentId = String(payment.id ?? paymentId);
  const checkout = parseCheckoutReference(payment.external_reference);

  if (checkout) {
    /**
     * `pending` / `in_process` — PSE, efectivo y transferencia llegan así POR
     * DISEÑO (`binary_mode` es false en el flujo web). Antes se descartaban sin
     * escribir nada: la clienta pagaba y en el CRM no existía ni el pago ni la
     * matrícula hasta que MP reenviara `approved`. Si ese segundo aviso se
     * perdía, el dinero entraba y nadie se enteraba.
     *
     * Ahora se registra PENDING contra una matrícula PENDING_PAYMENT, así que
     * el cobro es visible desde el primer aviso y el `approved` posterior sólo
     * actualiza la MISMA fila (`@@unique([provider, providerPaymentId])`).
     */
    if (!approved && !failed) {
      // El contacto se completa AQUÍ, no al aprobarse: un PSE tarda minutos y
      // uno en efectivo días. Sin esto el CRM enseña un `+pending:` anónimo
      // durante toda la espera, y la barrida nocturna —que reconoce lo
      // abandonado por ese mismo prefijo— lo daría por muerto.
      const contactId = await reconcilePendingCheckoutContact(
        checkout.contactId,
        {
          email: payment.payer?.email,
          firstName: payment.payer?.first_name,
          lastName: payment.payer?.last_name,
          phone: mercadoPagoPayerPhone(payment.payer),
          countryIso: payment.payer?.address?.country ?? "CO",
        }
      );

      // Si el email ya tenía ficha real, el temporal se borró y su matrícula
      // cayó en cascada: hay que abrir una nueva sobre la ficha buena. Queda
      // PENDING_PAYMENT, nunca ACTIVE — el dinero todavía no ha llegado.
      const enrollmentId =
        (await findEnrollmentForCheckout(contactId, checkout.planId)) ??
        (
          await createEnrollment({
            contactId,
            productId: checkout.planId,
            status: EnrollmentStatus.PENDING_PAYMENT,
            // Viene de un aviso real de Mercado Pago: no puede tumbarlo una
            // regla de higiene del panel.
            paidPurchase: true,
          })
        ).id;

      await recordPayment({
        enrollmentId,
        provider: PaymentProvider.MERCADO_PAGO,
        providerPaymentId,
        status: PaymentStatus.PENDING,
        currency,
        amountMinor,
        payerEmail: payment.payer?.email,
        rawPayload: payment,
      });
      return { outcome: "recorded", enrollmentId };
    }

    /**
     * Rechazado / cancelado / contracargo.
     *
     * Se registra igual que el pendiente, y por el mismo motivo: la clienta
     * intentó pagar. Al reconciliar el contacto deja de ser un `+pending:`
     * anónimo, así que `abandonCheckoutEnrollment` ya no lo barre (sale por
     * `real_contact`) y el rechazo queda visible — que es justo lo que hace
     * falta cuando el problema reportado es "no puedo pagar con tarjeta".
     *
     * Si Mercado Pago no reporta pagador, el contacto sigue temporal y la
     * barrida nocturna se lo lleva: no hay a quién llamar.
     */
    if (failed) {
      const contactId = await reconcilePendingCheckoutContact(
        checkout.contactId,
        {
          email: payment.payer?.email,
          firstName: payment.payer?.first_name,
          lastName: payment.payer?.last_name,
          phone: mercadoPagoPayerPhone(payment.payer),
          countryIso: payment.payer?.address?.country ?? "CO",
        }
      );

      const enrollmentId =
        (await findEnrollmentForCheckout(contactId, checkout.planId)) ??
        (
          await createEnrollment({
            contactId,
            productId: checkout.planId,
            status: EnrollmentStatus.PENDING_PAYMENT,
            // Viene de un aviso real de Mercado Pago: no puede tumbarlo una
            // regla de higiene del panel.
            paidPurchase: true,
          })
        ).id;

      await recordPayment({
        enrollmentId,
        provider: PaymentProvider.MERCADO_PAGO,
        providerPaymentId,
        status: PaymentStatus.FAILED,
        currency,
        amountMinor,
        payerEmail: payment.payer?.email,
        rawPayload: payment,
      });
      return { outcome: "recorded", enrollmentId };
    }
    // El contacto puede ser el temporal creado al abrir el checkout. Se
    // completa ANTES de matricular: si ya existe una ficha real con ese email
    // hay que matricular en ESA (y `Contact.email` es @unique).
    const contactId = await reconcilePendingCheckoutContact(checkout.contactId, {
      email: payment.payer?.email,
      firstName: payment.payer?.first_name,
      lastName: payment.payer?.last_name,
      phone: mercadoPagoPayerPhone(payment.payer),
      // Checkout Pro de Colombia: si MP no reporta país, es COP y es Colombia.
      countryIso: payment.payer?.address?.country ?? "CO",
    });

    const enrollmentId = await fulfillCheckoutPayment({
      contactId,
      productId: checkout.planId,
      provider: PaymentProvider.MERCADO_PAGO,
      providerPaymentId,
      status: PaymentStatus.APPROVED,
      currency,
      amountMinor,
      payerEmail: payment.payer?.email,
      rawPayload: payment,
      paidAt: new Date(),
      promoCodeRedemption: checkout.promoCode
        ? { code: checkout.promoCode, discountMinor: checkout.discountMinor ?? 0 }
        : undefined,
    });
    return { outcome: "recorded", enrollmentId };
  }

  const enrollmentId = await resolveEnrollmentFromReference(
    payment.external_reference
  );
  if (!enrollmentId) {
    return { outcome: "skipped", reason: "enrollment_not_found" };
  }

  await recordPayment({
    enrollmentId,
    provider: PaymentProvider.MERCADO_PAGO,
    providerPaymentId,
    status: approved
      ? PaymentStatus.APPROVED
      : failed
        ? PaymentStatus.FAILED
        : PaymentStatus.PENDING,
    currency,
    amountMinor,
    payerEmail: payment.payer?.email,
    rawPayload: payment,
    paidAt: approved ? new Date() : undefined,
  });

  return { outcome: "recorded", enrollmentId };
};
