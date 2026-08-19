import { NextResponse } from "next/server";
import { isPlanId } from "@/lib/plans";
import { getPlanFromDb, isActivePlanId } from "@/lib/plans-from-db";
import {
  mapCheckoutBeginError,
  resolveCheckoutContactIdForRequest,
  type CheckoutContactBody,
} from "@/lib/crm/checkout-enrollment";
import { recordAdTrackingConsent } from "@/lib/crm/contacts";
import { validatePromoCode } from "@/lib/crm/promo-codes";
import {
  clientIp,
  rateLimitDistributed,
} from "@/lib/api/rate-limit-distributed";
import { isStripeCheckoutEnabled } from "@/lib/payments/stripe/client";
import { resolveStripePrice } from "@/lib/payments/stripe/catalog";
import {
  createStripeCheckoutSession,
  type StripeCheckoutMode,
} from "@/lib/payments/stripe/checkout";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = CheckoutContactBody & {
  planId?: string;
  promoCode?: string;
  /** payment = cobro único; subscription = membresía recurrente. */
  mode?: StripeCheckoutMode;
  fromSession?: boolean;
};

function parseContactBody(body: Body): CheckoutContactBody {
  return {
    contactId: typeof body.contactId === "string" ? body.contactId : undefined,
    phone: typeof body.phone === "string" ? body.phone : undefined,
    phoneCountry:
      typeof body.phoneCountry === "string" ? body.phoneCountry : undefined,
    firstName: typeof body.firstName === "string" ? body.firstName : undefined,
    lastName: typeof body.lastName === "string" ? body.lastName : undefined,
    email: typeof body.email === "string" ? body.email : undefined,
    consentData: body.consentData === true,
  };
}

export async function POST(req: Request) {
  const ip = clientIp(req);
  const rl = await rateLimitDistributed(`stripe:checkout:${ip}`, 30, 60_000);
  if (!rl.ok) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  if (!isStripeCheckoutEnabled()) {
    return NextResponse.json({ error: "stripe_disabled" }, { status: 503 });
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const planId = body.planId;
  if (!planId || !isPlanId(planId) || !(await isActivePlanId(planId))) {
    return NextResponse.json({ error: "invalid_plan" }, { status: 400 });
  }

  const mode: StripeCheckoutMode =
    body.mode === "subscription" ? "subscription" : "payment";

  const plan = await getPlanFromDb(planId);
  if (!plan) {
    return NextResponse.json({ error: "invalid_plan" }, { status: 400 });
  }

  const price = await resolveStripePrice(planId, mode);
  if (!price) {
    // Producto nunca sincronizado con Stripe (o sin precio recurrente para
    // mode=subscription). Ver scripts/stripe/setup-products.ts.
    return NextResponse.json({ error: "no_stripe_price" }, { status: 400 });
  }

  let contactId: string;
  try {
    contactId = await resolveCheckoutContactIdForRequest({
      planId,
      contact: parseContactBody(body),
      fromSession: body.fromSession === true,
    });
  } catch (e) {
    const mapped = mapCheckoutBeginError(e);
    console.error("[stripe] contact register failed", e);
    return NextResponse.json(
      { error: mapped.error, message: mapped.message },
      { status: mapped.status }
    );
  }

  // Mismo punto común que PayPal/MP: un fallo aquí no puede tumbar el pago.
  await recordAdTrackingConsent(
    contactId,
    body.consentAdTracking === true
  ).catch((e) => console.error("[stripe] ad-tracking consent not recorded", e));

  let discountMinor = 0;
  let appliedPromoCode: string | undefined;
  if (body.promoCode?.trim()) {
    const validation = await validatePromoCode(
      body.promoCode,
      "USD",
      Math.round(plan.amountUsd * 100),
      plan.id
    );
    if (!validation.ok) {
      return NextResponse.json(
        { error: "invalid_promo_code", reason: validation.error },
        { status: 400 }
      );
    }
    discountMinor = validation.discountMinor;
    appliedPromoCode = validation.promoCode.code;
  }

  try {
    const session = await createStripeCheckoutSession({
      contactId,
      planId,
      priceId: price.priceId,
      mode,
      managedPayments: price.managedPayments,
      promo: appliedPromoCode
        ? { code: appliedPromoCode, discountMinor }
        : undefined,
      customerEmail: body.email?.trim() || undefined,
    });

    return NextResponse.json({
      url: session.url,
      sessionId: session.id,
      mode,
      contactId,
      checkoutReference: session.checkoutReference,
      managedPayments: price.managedPayments,
      discountMinor,
      promoCode: appliedPromoCode,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("[stripe] checkout session failed", message);
    return NextResponse.json(
      { error: "session_failed", detail: message },
      { status: 502 }
    );
  }
}
