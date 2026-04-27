import { NextResponse } from "next/server";
import { mercadoPagoItemAmount } from "../../../../lib/mercadopago/amount";
import { getPlan, isPlanId, type PlanId } from "../../../../lib/plans";
import { grossUpUsd, paypalFee } from "../../../../lib/pricing/fees";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = { planId?: unknown; provider?: "paypal" | "mercadopago" };

export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  if (!isPlanId(body.planId)) {
    return NextResponse.json({ error: "invalid_plan" }, { status: 400 });
  }

  const plan = getPlan(body.planId as PlanId);
  const provider = body.provider === "mercadopago" ? "mercadopago" : "paypal";

  if (provider === "paypal") {
    const b = grossUpUsd(plan.amountUsd, paypalFee());
    return NextResponse.json({
      provider: "paypal",
      currency: "USD",
      subtotal: b.net.toFixed(2),
      fee: b.fee.toFixed(2),
      total: b.gross.toFixed(2),
    });
  }

  try {
    const { net, fee, gross, currency_id } = mercadoPagoItemAmount(plan);
    const isCop = currency_id === "COP";
    const fmt = (n: number): string =>
      isCop ? String(Math.round(n)) : n.toFixed(2);
    return NextResponse.json({
      provider: "mercadopago",
      currency: currency_id,
      subtotal: fmt(net),
      fee: fmt(fee),
      total: fmt(gross),
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "amount_error";
    console.error("[quote] mercadopago amount", message);
    return NextResponse.json({ error: "config" }, { status: 500 });
  }
}
