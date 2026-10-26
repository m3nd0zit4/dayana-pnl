import { PaymentStatus } from "@prisma/client";
import { prisma } from "../db";
import { minorToMajor } from "../crm/money";
import { claimDailyAlert } from "../crm/daily-alert-flag";
import { emitPlatformNotification } from "../notifications/platform/emit";
import { getSiteUrl } from "../site-url";
import { purchaseEventId, sendCapiEvent } from "./capi";
import { MetaApiError } from "./client";

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
        | "no_match_keys"
        | "token_invalid";
    };

/**
 * El token de la Conversions API lo rechaza Meta (código 190 / HTTP 401: «The
 * access token could not be decrypted», visto el 23-oct).
 *
 * No es un fallo que reintentar mejore: el mismo token vuelve a fallar. Dejar
 * que el error suba hacía que Inngest reintentara el step varias veces y
 * marcara fallida la función `payment-approved` entera, y a nadie se le avisaba
 * de que Meta llevaba días sin recibir compras. Ahora el step termina como
 * «omitido», `capiSentAt` queda vacío (la compra se podrá reenviar con el
 * token nuevo) y el equipo recibe UN aviso al día.
 */
const isTokenFailure = (e: unknown): boolean =>
  e instanceof MetaApiError && (e.code === 190 || e.status === 401);

const CAPI_TOKEN_ALERT_SETTING = "meta.capi.token_alert_day" as const;

const alertTokenInvalidOncePerDay = async (): Promise<void> => {
  try {
    if (!(await claimDailyAlert(CAPI_TOKEN_ALERT_SETTING))) return;
    await emitPlatformNotification({
      eventType: "SYSTEM_ALERT",
      title: "Meta no está recibiendo tus compras",
      body:
        "Meta rechaza el token de la Conversions API (error 190), así que las compras " +
        "de quien aceptó la publicidad no llegan y los anuncios pierden esa señal. " +
        "Genera un token nuevo en Events Manager y pégalo en Ajustes → Integraciones. " +
        "Las compras que ya quedaron sin enviar NO se reenvían solas: cambia el token y " +
        "pide que se reenvíen (`bun scripts/capi-resend-unsent.ts --send`); Meta solo " +
        "acepta eventos de los últimos 7 días.",
      href: "/admin/ajustes/integraciones",
      entityType: "MetaCapi",
      entityId: "token",
      staff: "ALL",
    });
  } catch (e) {
    console.error("[meta/capi] no se pudo avisar del token inválido", e);
  }
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

  const event = {
    eventName: "Purchase" as const,
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
  };

  let result: Awaited<ReturnType<typeof sendCapiEvent>>;
  try {
    result = await sendCapiEvent(event);
  } catch (e) {
    if (isTokenFailure(e)) {
      await alertTokenInvalidOncePerDay();
      return { status: "skipped", reason: "token_invalid" };
    }
    throw e;
  }

  if (!result.sent) {
    return { status: "skipped", reason: result.reason };
  }

  await prisma.payment.update({
    where: { id: payment.id },
    data: { capiSentAt: new Date() },
  });

  return { status: "sent", paymentId: payment.id, eventId };
};
