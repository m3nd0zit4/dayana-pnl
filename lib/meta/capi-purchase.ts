import { PaymentStatus } from "@prisma/client";
import { prisma } from "../db";
import { minorToMajor } from "../crm/money";
import { getSiteUrl } from "../site-url";
import { purchaseEventId, sendCapiEvent } from "./capi";

/**
 * Envía el Purchase de un enrollment a la Conversions API.
 *
 * Se ejecuta como step de Inngest desde `payment-approved`: es el único punto
 * por el que pasan PayPal y Mercado Pago, tiene reintentos y está fuera del
 * camino crítico del webhook.
 */

export type CapiPurchaseOutcome =
  | { status: "sent"; paymentId: string; eventId: string }
  | {
      status: "skipped";
      reason:
        | "no_approved_payment"
        | "already_sent"
        | "no_ad_tracking_consent"
        | "not_configured"
        | "no_match_keys";
    };

export const sendPurchaseToMetaCapi = async (
  enrollmentId: string
): Promise<CapiPurchaseOutcome> => {
  const enrollment = await prisma.enrollment.findUnique({
    where: { id: enrollmentId },
    include: {
      contact: true,
      product: true,
      payments: {
        where: { status: PaymentStatus.APPROVED },
        orderBy: { paidAt: "desc" },
      },
    },
  });

  const payment = enrollment?.payments[0];
  if (!enrollment || !payment) {
    return { status: "skipped", reason: "no_approved_payment" };
  }

  // `recordPayment` usa upsert y puede reemitir `payment/approved`, así que el
  // sello es lo que impide contar la misma compra dos veces.
  if (payment.capiSentAt) {
    return { status: "skipped", reason: "already_sent" };
  }

  // El consentimiento manda. CAPI recupera señal que el navegador bloquea por
  // motivos técnicos; no es una vía para rodear una negativa del usuario.
  if (!enrollment.contact.consentAdTrackingAt) {
    return { status: "skipped", reason: "no_ad_tracking_consent" };
  }

  const eventId = purchaseEventId(payment.id);

  const result = await sendCapiEvent({
    eventName: "Purchase",
    eventId,
    eventTime: payment.paidAt ?? payment.createdAt,
    eventSourceUrl: `${getSiteUrl()}/pago/exito`,
    userData: {
      email: enrollment.contact.email,
      phoneE164: enrollment.contact.phoneE164,
      firstName: enrollment.contact.firstName,
      lastName: enrollment.contact.lastName,
      countryIso: enrollment.contact.countryIso,
    },
    customData: {
      currency: payment.currency,
      value: minorToMajor(payment.amountMinor, payment.currency),
      content_ids: [enrollment.product.id],
      content_name: enrollment.product.title,
      content_type: "product",
    },
  });

  if (!result.sent) {
    return { status: "skipped", reason: result.reason };
  }

  await prisma.payment.update({
    where: { id: payment.id },
    data: { capiSentAt: new Date() },
  });

  return { status: "sent", paymentId: payment.id, eventId };
};
