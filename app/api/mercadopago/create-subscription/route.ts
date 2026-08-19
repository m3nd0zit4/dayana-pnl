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
import {
  getPreapprovalPlan,
  planCheckoutUrl,
} from "@/lib/mercadopago/subscriptions";
import {
  clientIp,
  rateLimitDistributed,
} from "@/lib/api/rate-limit-distributed";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Alta de la mensualidad como suscripción recurrente en Mercado Pago.
 *
 * Hermano de `create-preference`, con dos diferencias de fondo:
 *
 * 1. **No se calcula el importe.** El `preapproval_plan` cobra un precio fijo
 *    que ya lleva el gross-up (`scripts/mercadopago/setup-subscription.ts`).
 * 2. **Sólo tarjeta.** MP no puede debitar PSE, Nequi ni efectivo de forma
 *    recurrente. Por eso esto NO sustituye a `create-preference`: la clienta
 *    colombiana elige entre suscribirse con tarjeta o pagar un mes suelto.
 *
 * Por lo primero, el promo no aplica: descontar exigiría un plan por código. Se
 * rechaza en vez de cobrar el total en silencio.
 */

type Body = CheckoutContactBody & {
  planId?: unknown;
  promoCode?: unknown;
  fromSession?: unknown;
};

export async function POST(req: NextRequest) {
  const ip = clientIp(req);
  const rl = await rateLimitDistributed(`mp-sub:${ip}`, 30, 60_000);
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
    select: { mercadoPagoPreapprovalPlanId: true },
  });
  if (!product?.mercadoPagoPreapprovalPlanId) {
    console.error("[mp-sub] producto sin preapproval plan", planId);
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
    console.error("[mp-sub] contact register failed", e);
    return NextResponse.json(
      { error: mapped.error, message: mapped.message },
      { status: mapped.status }
    );
  }

  await recordAdTrackingConsent(contactId, body.consentAdTracking === true).catch(
    (e) => console.error("[mp-sub] ad-tracking consent not recorded", e)
  );

  const checkoutReference = encodeCheckoutReference(contactId, planId);

  try {
    // El checkout vive en el plan; MP recoge ahí la tarjeta. Se consulta en vez
    // de construir la URL a mano para no depender del formato de MP.
    const plan = await getPreapprovalPlan(product.mercadoPagoPreapprovalPlanId);

    if (!plan.init_point) {
      console.error("[mp-sub] el plan no trae init_point", plan.id);
      return NextResponse.json({ error: "no_init_point" }, { status: 502 });
    }

    return NextResponse.json({
      init_point: planCheckoutUrl(plan.init_point, checkoutReference),
      contactId,
      checkoutReference,
      planId,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("[mp-sub] create failed", message);
    return NextResponse.json({ error: "subscription_failed" }, { status: 502 });
  }
}
