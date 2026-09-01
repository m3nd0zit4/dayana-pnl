import { NextResponse } from "next/server";
import { mercadoPagoItemAmount } from "../../../../lib/mercadopago/amount";
import { isPlanId } from "../../../../lib/plans";
import { getPlanFromDb, isActivePlanId } from "@/lib/plans-from-db";
import {
  grossUpUsd,
  paypalFee,
} from "../../../../lib/pricing/fees";
import {
  hasUsablePromoCode,
  validatePromoCode,
} from "@/lib/crm/promo-codes";
import {
  clientIp,
  rateLimitDistributed,
} from "@/lib/api/rate-limit-distributed";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = {
  planId?: unknown;
  provider?: "paypal" | "mercadopago";
  promoCode?: unknown;
};

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
  // Si no hay ningún código vivo para este plan, el modal ni siquiera pinta el
  // campo: un hueco que nunca acepta nada hace dudar de que el precio sea el
  // correcto y manda a buscar cupones fuera en vez de terminar la compra.
  const promoAvailable = await hasUsablePromoCode(body.planId);

  // Lemon Squeezy y PayPal comparten la rama USD: mismo cálculo, distinta
  // comisión. Sólo Mercado Pago cobra en COP y necesita rama propia.
  const provider =
    body.provider === "mercadopago"
      ? "mercadopago"

        : "paypal";
  const rawPromoCode =
    typeof body.promoCode === "string" ? body.promoCode.trim() : "";

  if (provider === "paypal") {
    let discountMinor = 0;
    let promoCode: string | undefined;
    let promoCodeError: string | undefined;
    if (rawPromoCode) {
      const validation = await validatePromoCode(
        rawPromoCode,
        "USD",
        Math.round(plan.amountUsd * 100),
        plan.id
      );
      if (validation.ok) {
        discountMinor = validation.discountMinor;
        promoCode = validation.promoCode.code;
      } else {
        promoCodeError = validation.error;
      }
    }
    const discountedNet = Math.max(0, plan.amountUsd - discountMinor / 100);
    const b = grossUpUsd(
      discountedNet,
      paypalFee()
    );
    return NextResponse.json({
      provider,
      currency: "USD",
      // Subtotal is always the plan's original price — the discount and fee
      // are separate line items, not baked into it. Only "total" reflects
      // what the discount actually changes.
      subtotal: plan.amountUsd.toFixed(2),
      fee: b.fee.toFixed(2),
      total: b.gross.toFixed(2),
      discountMinor,
      promoCode,
      promoCodeError,
      // El modal esconde el campo de promo si no hay ninguno vivo.
      promoAvailable,
    });
  }

  try {
    let discountMinor = 0;
    let promoCode: string | undefined;
    let promoCodeError: string | undefined;
    if (rawPromoCode) {
      const validation = await validatePromoCode(
        rawPromoCode,
        "COP",
        plan.amountCop ?? 0,
        plan.id
      );
      if (validation.ok) {
        discountMinor = validation.discountMinor;
        promoCode = validation.promoCode.code;
      } else {
        promoCodeError = validation.error;
      }
    }
    const discountedPlan =
      discountMinor > 0
        ? { ...plan, amountCop: Math.max(0, (plan.amountCop ?? 0) - discountMinor) }
        : plan;

    const { fee, gross, currency_id, referenceUsd } =
      mercadoPagoItemAmount(discountedPlan);
    // Subtotal always reflects the plan's original (pre-discount) price —
    // computed with the UNdiscounted plan, never `discountedPlan`, so the
    // discount only shows up in its own line and in the final total.
    const { net: originalNet } = mercadoPagoItemAmount(plan);
    const isCop = currency_id === "COP";
    const fmt = (n: number): string =>
      isCop ? String(Math.round(n)) : n.toFixed(2);
    const fmtUsd = (n: number): string => n.toFixed(2);

    return NextResponse.json({
      provider: "mercadopago",
      currency: currency_id,
      subtotal: fmt(originalNet),
      fee: fmt(fee),
      total: fmt(gross),
      discountMinor,
      promoCode,
      promoCodeError,
      // El modal esconde el campo de promo si no hay ninguno vivo.
      promoAvailable,
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
    if (message === "no_cop_price") {
      return NextResponse.json({ error: "no_cop_price" }, { status: 400 });
    }
    console.error("[quote] mercadopago amount", message);
    return NextResponse.json({ error: "config" }, { status: 500 });
  }
}
