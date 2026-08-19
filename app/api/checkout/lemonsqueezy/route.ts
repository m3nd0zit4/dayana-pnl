import { NextResponse } from "next/server";
import { isPlanId } from "@/lib/plans";
import { getPlanFromDb, isActivePlanId } from "@/lib/plans-from-db";
import {
  mapCheckoutBeginError,
  resolveCheckoutContactIdForRequest,
  type CheckoutContactBody,
} from "@/lib/crm/checkout-enrollment";
import { recordAdTrackingConsent } from "@/lib/crm/contacts";
import { createPendingCheckoutContact } from "@/lib/crm/checkout-placeholder";
import { validatePromoCode } from "@/lib/crm/promo-codes";
import {
  clientIp,
  rateLimitDistributed,
} from "@/lib/api/rate-limit-distributed";
import { grossUpUsd, lemonSqueezyFee } from "@/lib/pricing/fees";
import { isLemonSqueezyEnabled } from "@/lib/payments/lemonsqueezy/client";
import { resolveLemonSqueezyVariant } from "@/lib/payments/lemonsqueezy/catalog";
import { createLemonSqueezyCheckout } from "@/lib/payments/lemonsqueezy/checkout";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = CheckoutContactBody & {
  planId?: string;
  promoCode?: string;
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
  const rl = await rateLimitDistributed(`ls:checkout:${ip}`, 30, 60_000);
  if (!rl.ok) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  if (!isLemonSqueezyEnabled()) {
    return NextResponse.json({ error: "lemonsqueezy_disabled" }, { status: 503 });
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

  const plan = await getPlanFromDb(planId);
  if (!plan) {
    return NextResponse.json({ error: "invalid_plan" }, { status: 400 });
  }

  const variant = await resolveLemonSqueezyVariant(planId);
  if (!variant) {
    // Producto nunca sincronizado con LS. Ver scripts/lemonsqueezy/setup-products.ts.
    return NextResponse.json({ error: "no_lemonsqueezy_variant" }, { status: 400 });
  }

  // Sin formulario previo: Lemon Squeezy recoge email y nombre por obligación
  // fiscal, así que aquí basta un contacto temporal y el webhook lo completa.
  // Si la visitante SÍ mandó datos (o tiene sesión), se respeta ese camino.
  const contact = parseContactBody(body);
  const hasContactData = Boolean(
    contact.contactId || contact.phone || contact.email
  );

  let contactId: string;
  try {
    contactId =
      hasContactData || body.fromSession === true
        ? await resolveCheckoutContactIdForRequest({
            planId,
            contact,
            fromSession: body.fromSession === true,
          })
        : await createPendingCheckoutContact(planId);
  } catch (e) {
    const mapped = mapCheckoutBeginError(e);
    console.error("[lemonsqueezy] contact register failed", e);
    return NextResponse.json(
      { error: mapped.error, message: mapped.message },
      { status: mapped.status }
    );
  }

  // Mismo punto común que PayPal/MP: un fallo aquí no puede tumbar el pago.
  await recordAdTrackingConsent(
    contactId,
    body.consentAdTracking === true
  ).catch((e) =>
    console.error("[lemonsqueezy] ad-tracking consent not recorded", e)
  );

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

  // El precio del plan es lo que Dayana quiere recibir NETO; el cliente paga el
  // bruto. El descuento se resta ANTES del gross-up para que la comisión no se
  // cobre sobre dinero que nadie paga.
  const netUsd = Math.max(0, plan.amountUsd - discountMinor / 100);
  const { gross } = grossUpUsd(netUsd, lemonSqueezyFee());
  const amountCents = Math.round(gross * 100);

  try {
    const checkout = await createLemonSqueezyCheckout({
      contactId,
      planId,
      variantId: variant.variantId,
      subscription: variant.subscription,
      amountCents,
      promo: appliedPromoCode
        ? { code: appliedPromoCode, discountMinor }
        : undefined,
      email: body.email?.trim() || undefined,
      name: [body.firstName, body.lastName].filter(Boolean).join(" ").trim() ||
        undefined,
    });

    return NextResponse.json({
      url: checkout.url,
      contactId,
      checkoutReference: checkout.checkoutReference,
      subscription: variant.subscription,
      amountCents,
      discountMinor,
      promoCode: appliedPromoCode,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("[lemonsqueezy] checkout failed", message);
    return NextResponse.json(
      { error: "checkout_failed", detail: message },
      { status: 502 }
    );
  }
}
