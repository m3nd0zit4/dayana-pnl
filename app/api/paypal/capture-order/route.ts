import { NextRequest, NextResponse } from "next/server";
import { PaymentProvider, PaymentStatus } from "@prisma/client";
import {
  capturePayPalOrderRequest,
  getPayPalAccessToken,
  getPayPalOrderRequest,
} from "../../../../lib/paypal/server";
import { enrichContactFromPayer } from "@/lib/crm/contacts";
import { reconcilePendingCheckoutContact } from "@/lib/crm/checkout-placeholder";
import { extractPayPalPayer } from "@/lib/crm/paypal-payer";
import { fulfillCheckoutPayment } from "@/lib/crm/checkout-fulfillment";
import { parseCheckoutReference } from "@/lib/crm/checkout-reference";
import {
  assertEnrollmentPayable,
  assertPayPalCaptureAmount,
  enrollmentPaymentErrorStatus,
  EnrollmentPaymentError,
} from "@/lib/crm/enrollment-payment";
import { recordPayment, resolveEnrollmentFromReference } from "@/lib/crm/payments";
import { PayPalApiError, type PaymentFailure } from "@/lib/payments/errors";
import { getPlanFromDb } from "@/lib/plans-from-db";
import { grossUpUsd, paypalFee } from "../../../../lib/pricing/fees";
import { prisma } from "@/lib/db";
import {
  clientIp,
  rateLimitDistributed,
} from "@/lib/api/rate-limit-distributed";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = { orderID?: unknown };

const isLikelyOrderId = (value: string): boolean =>
  /^[A-Za-z0-9_-]{10,64}$/.test(value);

const extractCapture = (payload: unknown): {
  captureId?: string;
  enrollmentRef?: string;
  amountMinor?: number;
  currency?: string;
} => {
  if (!payload || typeof payload !== "object") return {};
  const p = payload as {
    purchase_units?: Array<{
      custom_id?: string;
      reference_id?: string;
      payments?: {
        captures?: Array<{
          id?: string;
          status?: string;
          amount?: { currency_code?: string; value?: string };
        }>;
      };
    }>;
  };
  const unit = p.purchase_units?.[0];
  const capture = unit?.payments?.captures?.[0];
  const amountValue = Number(capture?.amount?.value ?? 0);
  return {
    captureId: capture?.id,
    enrollmentRef: unit?.custom_id ?? unit?.reference_id,
    amountMinor: Math.round(amountValue * 100),
    currency: capture?.amount?.currency_code ?? "USD",
  };
};

export async function POST(req: NextRequest) {
  const ip = clientIp(req);
  const rl = await rateLimitDistributed(`paypal:capture:${ip}`, 20, 60_000);
  if (!rl.ok) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json(
      { error: "invalid_json", message: "Body inválido" },
      { status: 400 }
    );
  }

  const orderID =
    typeof body.orderID === "string" ? body.orderID.trim() : "";
  if (!orderID || !isLikelyOrderId(orderID)) {
    return NextResponse.json(
      { error: "invalid_order", message: "Orden de PayPal inválida" },
      { status: 400 }
    );
  }

  try {
    const accessToken = await getPayPalAccessToken();
    const result = await capturePayPalOrderRequest(accessToken, orderID);
    const { captureId, enrollmentRef, amountMinor, currency } =
      extractCapture(result);
    const status =
      typeof result === "object" &&
      result !== null &&
      "status" in result &&
      typeof (result as { status: unknown }).status === "string"
        ? (result as { status: string }).status
        : "COMPLETED";

    let enrollmentId: string | null = null;

    if (
      enrollmentRef &&
      captureId &&
      amountMinor != null &&
      currency
    ) {
      const checkout = parseCheckoutReference(enrollmentRef);

      if (checkout) {
        const plan = await getPlanFromDb(checkout.planId);
        if (!plan) {
          return NextResponse.json(
            { error: "invalid_plan", message: "Plan no disponible" },
            { status: 400 }
          );
        }
        // The discount is read back from the reference (baked in at
        // create-order time), never re-validated here — the code could have
        // expired or hit its cap in the minutes since checkout started, and
        // re-checking would wrongly reject a payment that was already
        // correctly charged at the discounted price.
        const discountMinor = checkout.discountMinor ?? 0;
        const discountedNetUsd = Math.max(0, plan.amountUsd - discountMinor / 100);
        const expectedGross = grossUpUsd(discountedNetUsd, paypalFee()).gross;
        assertPayPalCaptureAmount(amountMinor, currency, expectedGross);

        // El contacto puede ser el temporal creado al abrir el checkout. Se
        // completa ANTES de matricular: si ya existe una ficha real con ese
        // email hay que matricular en ESA, no crear una segunda (y `email` es
        // @unique, así que actualizar a ciegas reventaría).
        const payer = extractPayPalPayer(result);
        const paidContactId = await reconcilePendingCheckoutContact(
          checkout.contactId,
          payer
        );

        enrollmentId = await fulfillCheckoutPayment({
          contactId: paidContactId,
          productId: checkout.planId,
          provider: PaymentProvider.PAYPAL,
          providerPaymentId: captureId,
          providerOrderId: orderID,
          status:
            status === "COMPLETED"
              ? PaymentStatus.APPROVED
              : PaymentStatus.PENDING,
          currency: currency ?? "USD",
          amountMinor,
          rawPayload: result,
          paidAt: status === "COMPLETED" ? new Date() : undefined,
          payerEmail: extractPayPalPayer(result).email,
          promoCodeRedemption: checkout.promoCode
            ? { code: checkout.promoCode, discountMinor }
            : undefined,
        });

        if (status === "COMPLETED") {
          await enrichContactFromPayer(paidContactId, payer);
        }
      } else {
        enrollmentId = await resolveEnrollmentFromReference(enrollmentRef);
        if (!enrollmentId) {
          return NextResponse.json(
            { error: "NOT_FOUND", message: "Enrollment not found" },
            { status: 404 }
          );
        }

        const row = await prisma.enrollment.findUnique({
          where: { id: enrollmentId },
          select: { productId: true },
        });
        if (!row) {
          return NextResponse.json(
            { error: "NOT_FOUND", message: "Enrollment not found" },
            { status: 404 }
          );
        }

        try {
          await assertEnrollmentPayable(enrollmentId, row.productId);
          const plan = await getPlanFromDb(row.productId);
          if (!plan) {
            return NextResponse.json(
              { error: "invalid_plan", message: "Plan no disponible" },
              { status: 400 }
            );
          }
          const expectedGross = grossUpUsd(plan.amountUsd, paypalFee()).gross;
          assertPayPalCaptureAmount(amountMinor, currency, expectedGross);
        } catch (e) {
          if (e instanceof EnrollmentPaymentError) {
            return NextResponse.json(
              { error: e.code, message: e.message },
              { status: enrollmentPaymentErrorStatus(e.code) }
            );
          }
          throw e;
        }

        await recordPayment({
          enrollmentId,
          provider: PaymentProvider.PAYPAL,
          providerPaymentId: captureId,
          providerOrderId: orderID,
          status:
            status === "COMPLETED"
              ? PaymentStatus.APPROVED
              : PaymentStatus.PENDING,
          currency: currency ?? "USD",
          amountMinor,
          rawPayload: result,
          paidAt: status === "COMPLETED" ? new Date() : undefined,
          payerEmail: extractPayPalPayer(result).email,
        });

        if (status === "COMPLETED") {
          const enrollment = await prisma.enrollment.findUnique({
            where: { id: enrollmentId },
            select: { contactId: true },
          });
          if (enrollment) {
            await enrichContactFromPayer(
              enrollment.contactId,
              extractPayPalPayer(result)
            );
          }
        }
      }
    }

    return NextResponse.json({
      ok: true,
      orderID,
      captureId,
      enrollmentId,
      status,
    });
  } catch (error) {
    /**
     * Aquí acababa el caso real: cualquier fallo —incluido un 422 con el banco
     * de la clienta rechazando la tarjeta— salía con el mismo mensaje genérico,
     * y quien llamaba no podía saber si el pago estaba rechazado o sólo
     * tardando. `PayPalApiError` trae la clasificación; se propaga para que la
     * pantalla de resultado diga la verdad.
     */
    if (error instanceof PayPalApiError) {
      const { failure } = error;
      console.error(
        "[paypal] capture-order rechazado",
        failure.code,
        failure.debugId ?? "sin debug_id"
      );

      // Que el rechazo quede en el CRM. Sin esto no había forma de saber que
      // esa clienta lo intentó, ni de llamarla: el intento no existía.
      if (failure.outcome === "rejected") {
        await recordPayPalFailure(orderID, failure).catch((e) =>
          console.error("[paypal] no se pudo registrar el rechazo", e)
        );
      }

      return NextResponse.json(
        {
          error: "paypal_error",
          outcome: failure.outcome,
          code: failure.code,
          debugId: failure.debugId,
          message: failure.buyerMessage,
        },
        // Un rechazo del banco no es un fallo del servidor: 402 lo dice mejor
        // que un 500, y deja el 500 para lo que sí es culpa nuestra.
        { status: failure.outcome === "rejected" ? 402 : 500 }
      );
    }

    const message =
      error instanceof Error ? error.message : "Error desconocido";
    console.error("[paypal] capture-order failed", message);
    return NextResponse.json(
      {
        error: "paypal_error",
        outcome: "unknown",
        message:
          "No pudimos confirmar el pago en PayPal. Si ves un cargo, contáctanos por WhatsApp con el correo de PayPal.",
      },
      { status: 500 }
    );
  }
}

/**
 * Deja constancia de un pago que PayPal rechazó.
 *
 * La referencia del checkout viaja dentro de la orden, no en la respuesta de
 * error, así que hay que ir a buscarla. Es una llamada extra que sólo ocurre
 * en el camino de fallo — a cambio, el intento deja de ser invisible: aparece
 * en Pagos con el motivo y dispara el aviso al equipo.
 *
 * Todo lo que puede salir mal aquí se traga a propósito. Este es el manejador
 * de un error; si falla, la clienta debe seguir recibiendo su mensaje.
 */
const recordPayPalFailure = async (
  orderID: string,
  failure: PaymentFailure
): Promise<void> => {
  const token = await getPayPalAccessToken();
  const order = await getPayPalOrderRequest(token, orderID);
  if (!order) return;

  const unit = (
    order as {
      purchase_units?: {
        custom_id?: string;
        amount?: { value?: string; currency_code?: string };
      }[];
    }
  ).purchase_units?.[0];

  const reference = unit?.custom_id;
  if (!reference) return;

  const enrollmentId = await resolveEnrollmentFromReference(reference);
  if (!enrollmentId) return;

  const currency = (unit?.amount?.currency_code ?? "USD").toUpperCase();
  const value = Number(unit?.amount?.value ?? "0");
  const amountMinor =
    currency === "COP" ? Math.round(value) : Math.round(value * 100);

  await recordPayment({
    enrollmentId,
    provider: PaymentProvider.PAYPAL,
    // La orden identifica el intento. El id de captura no existe: nunca hubo
    // captura, y sin este prefijo un reintento sobre la misma orden chocaría
    // con el pago bueno en @@unique([provider, providerPaymentId]).
    providerPaymentId: `failed:${orderID}`,
    providerOrderId: orderID,
    status: PaymentStatus.FAILED,
    currency,
    amountMinor,
    failureCode: failure.rawCode ?? failure.code,
    failureMessage: failure.staffMessage,
    rawPayload: order,
  });
};
