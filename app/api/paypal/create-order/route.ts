import { NextRequest, NextResponse } from "next/server";
import {
  createPayPalOrderRequest,
  getPayPalAccessToken,
} from "../../../../lib/paypal/server";
import { getPlan, isPlanId, type PlanId } from "../../../../lib/plans";
import { grossUpUsd, paypalFee } from "../../../../lib/pricing/fees";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PAYPAL_CURRENCY = "USD";

type Body = { planId?: unknown };

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

  if (!isPlanId(body.planId)) {
    return NextResponse.json(
      { error: "invalid_plan", message: "Plan no reconocido" },
      { status: 400 }
    );
  }

  const planId = body.planId as PlanId;
  const plan = getPlan(planId);
  const breakdown = grossUpUsd(plan.amountUsd, paypalFee());
  const amountValue = breakdown.gross.toFixed(2);
  const itemTotalValue = breakdown.net.toFixed(2);
  const handlingValue = breakdown.fee.toFixed(2);

  try {
    const accessToken = await getPayPalAccessToken();
    const { id } = await createPayPalOrderRequest({
      accessToken,
      planId: plan.id,
      planTitle: plan.title,
      sessions: plan.sessions,
      amountValue,
      currencyCode: PAYPAL_CURRENCY,
      itemTotalValue,
      handlingValue,
    });

    return NextResponse.json({
      orderID: id,
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
