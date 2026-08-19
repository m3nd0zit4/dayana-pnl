import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { isPlanId } from "../../../../lib/plans";
import { isActivePlanId } from "@/lib/plans-from-db";
import { encodeCheckoutReference } from "@/lib/crm/checkout-reference";
import { createPendingCheckoutContact } from "@/lib/crm/checkout-placeholder";
import { recordAdTrackingConsent } from "@/lib/crm/contacts";
import {
  mapCheckoutBeginError,
  resolveCheckoutContactIdForRequest,
} from "@/lib/crm/checkout-enrollment";
import type { CheckoutContactBody } from "@/lib/crm/checkout-enrollment";
import { createPayPalSubscription } from "@/lib/paypal/subscriptions";
import { siteBaseUrl } from "@/lib/mercadopago/amount";
import {
  clientIp,
  rateLimitDistributed,
} from "@/lib/api/rate-limit-distributed";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Alta de la mensualidad como suscripción recurrente.
 *
 * Hermano de `create-order`, con una diferencia de fondo: aquí NO se calcula el
 * importe. Un Billing Plan de PayPal cobra un precio fijo que ya lleva el
 * gross-up horneado (`scripts/paypal/setup-subscription.ts`), así que el único
 * dato que viaja es qué plan y contra qué referencia de checkout.
 *
 * Por lo mismo, **el promo no se puede aplicar a una suscripción**: descontar
 * exigiría un plan distinto por código. Se rechaza en vez de cobrarlo entero en
 * silencio, que sería cobrarle de más a alguien que cree tener descuento.
 */

type Body = CheckoutContactBody & {
  planId?: unknown;
  promoCode?: unknown;
  fromSession?: unknown;
};

export async function POST(req: NextRequest) {
  const ip = clientIp(req);
  const rl = await rateLimitDistributed(`paypal-sub:${ip}`, 30, 60_000);
  if (!rl.ok) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const planId = body.planId;
  if (!isPlanId(planId) || !(await isActivePlanId(planId))) {
    return NextResponse.json({ error: "invalid_plan" }, { status: 400 });
  }

  const product = await prisma.product.findUnique({
    where: { id: planId },
    select: { paypalPlanId: true },
  });
  if (!product?.paypalPlanId) {
    // Sin plan creado en PayPal no hay nada que cobrar. Se falla claro en vez
    // de mandar a la clienta a una pantalla rota.
    console.error("[paypal-sub] producto sin paypalPlanId", planId);
    return NextResponse.json({ error: "no_subscription_plan" }, { status: 400 });
  }

  if (typeof body.promoCode === "string" && body.promoCode.trim()) {
    return NextResponse.json({ error: "promo_not_supported" }, { status: 400 });
  }

  const contact: CheckoutContactBody = {
    contactId: typeof body.contactId === "string" ? body.contactId : undefined,
    phone: typeof body.phone === "string" ? body.phone : undefined,
    phoneCountry:
      typeof body.phoneCountry === "string" ? body.phoneCountry : undefined,
    email: typeof body.email === "string" ? body.email : undefined,
    firstName: typeof body.firstName === "string" ? body.firstName : undefined,
    lastName: typeof body.lastName === "string" ? body.lastName : undefined,
    consentData: body.consentData,
  };
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
    console.error("[paypal-sub] contact register failed", e);
    return NextResponse.json(
      { error: mapped.error, message: mapped.message },
      { status: mapped.status }
    );
  }

  await recordAdTrackingConsent(contactId, body.consentAdTracking === true).catch(
    (e) => console.error("[paypal-sub] ad-tracking consent not recorded", e)
  );

  const checkoutReference = encodeCheckoutReference(contactId, planId);
  const base = siteBaseUrl();

  try {
    const subscription = await createPayPalSubscription({
      planId: product.paypalPlanId,
      checkoutReference,
      returnUrl: `${base}/pago/exito?suscripcion=1&ref=${encodeURIComponent(checkoutReference)}`,
      cancelUrl: `${base}/pago/cancelado`,
      subscriberEmail: contact.email,
    });

    if (!subscription.approveUrl) {
      console.error("[paypal-sub] sin enlace de aprobación", subscription.id);
      return NextResponse.json({ error: "no_approve_url" }, { status: 502 });
    }

    return NextResponse.json({
      subscriptionId: subscription.id,
      approveUrl: subscription.approveUrl,
      contactId,
      checkoutReference,
      planId,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("[paypal-sub] create failed", message);
    return NextResponse.json({ error: "subscription_failed" }, { status: 502 });
  }
}
