import { NextRequest, NextResponse } from "next/server";
import { PaymentProvider, PaymentStatus } from "@prisma/client";
import {
  capturePayPalOrderRequest,
  getPayPalAccessToken,
} from "../../../../lib/paypal/server";
import { recordPayment, resolveEnrollmentFromReference } from "@/lib/crm/payments";
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
    if (enrollmentRef) {
      enrollmentId = await resolveEnrollmentFromReference(enrollmentRef);
    }

    if (enrollmentId && captureId && amountMinor != null) {
      await recordPayment({
        enrollmentId,
        provider: PaymentProvider.PAYPAL,
        providerPaymentId: captureId,
        providerOrderId: orderID,
        status:
          status === "COMPLETED" ? PaymentStatus.APPROVED : PaymentStatus.PENDING,
        currency: currency ?? "USD",
        amountMinor,
        rawPayload: result,
        paidAt: status === "COMPLETED" ? new Date() : undefined,
      });
    }

    return NextResponse.json({
      ok: true,
      orderID,
      captureId,
      enrollmentId,
      status,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Error desconocido";
    console.error("[paypal] capture-order failed", message);
    return NextResponse.json(
      {
        error: "paypal_error",
        message:
          "No pudimos confirmar el pago en PayPal. Si ves un cargo, contáctanos por WhatsApp con el correo de PayPal.",
      },
      { status: 500 }
    );
  }
}
