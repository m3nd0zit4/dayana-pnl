import { NextRequest, NextResponse } from "next/server";
import {
  createPayPalOrderRequest,
  getPayPalAccessToken,
} from "../../../../lib/paypal/server";
import { isPlanId } from "../../../../lib/plans";
import { getPlanFromDb, isActivePlanId } from "@/lib/plans-from-db";
import { grossUpUsd, paypalFee } from "../../../../lib/pricing/fees";
import { createPendingPaymentEnrollment } from "@/lib/crm/enrollments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PAYPAL_CURRENCY = "USD";

type Body = { planId?: unknown; enrollmentId?: unknown };

export async function POST(req: NextRequest) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json(
      { error: "invalid_json", message: "Body inválido" },
      { status: 400 }
    );
  }

  if (!isPlanId(body.planId) || !(await isActivePlanId(body.planId))) {
    return NextResponse.json(
      { error: "invalid_plan", message: "Plan no reconocido" },
      { status: 400 }
    );
  }

  const planId = body.planId;
  const plan = await getPlanFromDb(planId);
  if (!plan) {
    return NextResponse.json(
      { error: "invalid_plan", message: "Plan no disponible" },
      { status: 400 }
    );
  }
  const breakdown = grossUpUsd(plan.amountUsd, paypalFee());
  const amountValue = breakdown.gross.toFixed(2);
  const itemTotalValue = breakdown.net.toFixed(2);
  const handlingValue = breakdown.fee.toFixed(2);

  let enrollmentId =
    typeof body.enrollmentId === "string" ? body.enrollmentId : undefined;

  try {
    if (!enrollmentId) {
      const enrollment = await createPendingPaymentEnrollment({
        productId: planId,
      });
      enrollmentId = enrollment.id;
    }
  } catch (e) {
    console.error("[paypal] enrollment create failed", e);
    return NextResponse.json(
      { error: "crm_unavailable", message: "No se pudo iniciar el registro del pago." },
      { status: 503 }
    );
  }

  try {
    const accessToken = await getPayPalAccessToken();
    const { id } = await createPayPalOrderRequest({
      accessToken,
      planId: plan.id,
      enrollmentId,
      planTitle: plan.title,
      sessions: plan.sessions,
      amountValue,
      currencyCode: PAYPAL_CURRENCY,
      itemTotalValue,
      handlingValue,
    });

    return NextResponse.json({
      orderID: id,
      enrollmentId,
      amountValue,
      currency: PAYPAL_CURRENCY,
      planId: plan.id,
      planTitle: plan.title,
      sessions: plan.sessions,
      breakdown: {
        subtotal: itemTotalValue,
        fee: handlingValue,
        total: amountValue,
      },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Error desconocido";
    console.error("[paypal] create-order failed", message);
    return NextResponse.json(
      {
        error: "paypal_error",
        message:
          "No pudimos iniciar PayPal. Revisa credenciales (sandbox/live) e intenta de nuevo.",
      },
      { status: 500 }
    );
  }
}
