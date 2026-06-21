import { NextResponse } from "next/server";
import { mercadoPagoItemAmount } from "../../../../lib/mercadopago/amount";
import { isPlanId } from "../../../../lib/plans";
import { getPlanFromDb, isActivePlanId } from "@/lib/plans-from-db";
import { grossUpUsd, paypalFee } from "../../../../lib/pricing/fees";
import {
  clientIp,
  rateLimitDistributed,
} from "@/lib/api/rate-limit-distributed";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = { planId?: unknown; provider?: "paypal" | "mercadopago" };

export async function POST(req: Request) {
  const ip = clientIp(req);
  const rl = await rateLimitDistributed(`quote:${ip}`, 60, 60_000);
  if (!rl.ok) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  if (!isPlanId(body.planId) || !(await isActivePlanId(body.planId))) {
    return NextResponse.json({ error: "invalid_plan" }, { status: 400 });
  }

  const plan = await getPlanFromDb(body.planId);
  if (!plan) {
    return NextResponse.json({ error: "invalid_plan" }, { status: 400 });
  }
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
    const { net, fee, gross, currency_id, referenceUsd } =
      mercadoPagoItemAmount(plan);
    const isCop = currency_id === "COP";
    const fmt = (n: number): string =>
      isCop ? String(Math.round(n)) : n.toFixed(2);
    const fmtUsd = (n: number): string => n.toFixed(2);

    return NextResponse.json({
      provider: "mercadopago",
      currency: currency_id,
      subtotal: fmt(net),
      fee: fmt(fee),
      total: fmt(gross),
      ...(referenceUsd
        ? {
            referenceCurrency: "USD" as const,
            referenceSubtotal: fmtUsd(referenceUsd.net),
            referenceFee: fmtUsd(referenceUsd.fee),
            referenceTotal: fmtUsd(referenceUsd.gross),
          }
        : {}),
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "amount_error";
    console.error("[quote] mercadopago amount", message);
    return NextResponse.json({ error: "config" }, { status: 500 });
  }
}
