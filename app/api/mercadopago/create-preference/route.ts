import { NextResponse } from "next/server";
import { isPlanId } from "../../../../lib/plans";
import { getPlanFromDb, isActivePlanId } from "@/lib/plans-from-db";
import {
  mercadoPagoItemAmount,
  siteBaseUrl,
} from "../../../../lib/mercadopago/amount";
import {
  mapCheckoutBeginError,
  resolveCheckoutContactIdForRequest,
  type CheckoutContactBody,
} from "@/lib/crm/checkout-enrollment";
import { encodeCheckoutReference } from "@/lib/crm/checkout-reference";
import { recordAdTrackingConsent } from "@/lib/crm/contacts";
import { validatePromoCode } from "@/lib/crm/promo-codes";
import {
  clientIp,
  rateLimitDistributed,
} from "@/lib/api/rate-limit-distributed";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = CheckoutContactBody & {
  planId?: string;
  promoCode?: string;
  /** full = todos los medios; cards = binary_mode (pago en línea con tarjeta) */
  mode?: "full" | "cards";
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
  const rl = await rateLimitDistributed(`mp:preference:${ip}`, 30, 60_000);
  if (!rl.ok) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  const token = process.env.MERCADOPAGO_ACCESS_TOKEN;
  if (!token?.trim()) {
    return NextResponse.json(
      { error: "missing_mercadopago_token" },
      { status: 503 }
    );
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

  const mode = body.mode === "cards" ? "cards" : "full";
  const plan = await getPlanFromDb(planId);
  if (!plan) {
    return NextResponse.json({ error: "invalid_plan" }, { status: 400 });
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
    console.error("[mercadopago] contact register failed", e);
    return NextResponse.json(
      { error: mapped.error, message: mapped.message },
      { status: mapped.status }
    );
  }

  // Ver la nota equivalente en paypal/create-order: único punto común a todas
  // las vías de compra, y un fallo aquí no puede tumbar el pago.
  await recordAdTrackingConsent(
    contactId,
    body.consentAdTracking === true
  ).catch((e) =>
    console.error("[mercadopago] ad-tracking consent not recorded", e)
  );

  let discountMinor = 0;
  let appliedPromoCode: string | undefined;
  if (body.promoCode?.trim()) {
    const validation = await validatePromoCode(
      body.promoCode,
      "COP",
      plan.amountCop ?? 0
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

  const checkoutReference = encodeCheckoutReference(
    contactId,
    planId,
    appliedPromoCode
      ? { code: appliedPromoCode, discountMinor }
      : undefined
  );

  const discountedPlan =
    discountMinor > 0
      ? { ...plan, amountCop: Math.max(0, (plan.amountCop ?? 0) - discountMinor) }
      : plan;

  let net: number;
  let fee: number;
  let currency_id: string;
  try {
    ({ net, fee, currency_id } = mercadoPagoItemAmount(discountedPlan));
  } catch (e) {
    const message = e instanceof Error ? e.message : "amount_error";
    if (message === "no_cop_price") {
      // Plan sin precio COP en el CRM: no se vende en COP.
      return NextResponse.json({ error: "no_cop_price" }, { status: 400 });
    }
    console.error("[mercadopago] amount", message);
    return NextResponse.json({ error: "config" }, { status: 500 });
  }

  const base = siteBaseUrl();
  const title = `${plan.title} — ${plan.sessions}`;
  const allowAutoReturn = /^https:\/\//i.test(base) && !/localhost/i.test(base);

  const items: Array<Record<string, unknown>> = [
    {
      title,
      quantity: 1,
      unit_price: net,
      currency_id,
    },
  ];
  if (fee > 0) {
    items.push({
      title: "Comisión de procesamiento",
      quantity: 1,
      unit_price: fee,
      currency_id,
    });
  }

  const successUrl = `${base}/pago/exito`;
  const cancelUrl = `${base}/pago/cancelado`;

  const preferenceBody: Record<string, unknown> = {
    items,
    external_reference: checkoutReference,
    back_urls: {
      success: successUrl,
      failure: cancelUrl,
      pending: successUrl,
    },
    statement_descriptor: "DAYANA PNL",
    binary_mode: mode === "cards",
  };
  if (allowAutoReturn) {
    preferenceBody.auto_return = "approved";
    // Explicit per-preference URL (only when publicly reachable): registering
    // a payment must not depend on whichever webhook is configured — or not
    // — in the MP dashboard. That silent misconfiguration is what let
    // approved payments never reach the CRM.
    preferenceBody.notification_url = `${base}/api/webhooks/mercadopago`;
  }

  try {
    const res = await fetch(
      "https://api.mercadopago.com/checkout/preferences",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(preferenceBody),
      }
    );

    const data = (await res.json()) as {
      init_point?: string;
      sandbox_init_point?: string;
      message?: string;
    };

    if (!res.ok) {
      console.error("[mercadopago] preference failed", res.status, data);
      return NextResponse.json(
        { error: "preference_failed", detail: data.message },
        { status: 502 }
      );
    }

    const isTestToken = token.trim().startsWith("TEST-");
    const init_point =
      isTestToken && data.sandbox_init_point
        ? data.sandbox_init_point
        : data.init_point;

    if (!init_point) {
      return NextResponse.json({ error: "no_init_point" }, { status: 502 });
    }

    return NextResponse.json({
      init_point,
      mode,
      contactId,
      checkoutReference,
      discountMinor,
      promoCode: appliedPromoCode,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("[mercadopago] preference exception", message);
    return NextResponse.json({ error: "network" }, { status: 502 });
  }
}
