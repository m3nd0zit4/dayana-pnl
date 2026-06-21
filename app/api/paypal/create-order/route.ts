import { NextRequest, NextResponse } from "next/server";
import {
  createPayPalOrderRequest,
  getPayPalAccessToken,
} from "../../../../lib/paypal/server";
import { isPlanId } from "../../../../lib/plans";
import { getPlanFromDb, isActivePlanId } from "@/lib/plans-from-db";
import { grossUpUsd, paypalFee } from "../../../../lib/pricing/fees";
import {
  beginCheckoutContact,
  mapCheckoutBeginError,
} from "@/lib/crm/checkout-enrollment";
import type { CheckoutContactBody } from "@/lib/crm/checkout-enrollment";
import { encodeCheckoutReference } from "@/lib/crm/checkout-reference";
import {
  clientIp,
  rateLimitDistributed,
} from "@/lib/api/rate-limit-distributed";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PAYPAL_CURRENCY = "USD";

type Body = CheckoutContactBody & {
  planId?: unknown;
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

export async function POST(req: NextRequest) {
  const ip = clientIp(req);
  const rl = await rateLimitDistributed(`paypal:create:${ip}`, 30, 60_000);
  if (!rl.ok) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

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

  let contactId: string;
  try {
    const begun = await beginCheckoutContact({
      planId,
      contact: parseContactBody(body),
    });
    contactId = begun.contactId;
  } catch (e) {
    const mapped = mapCheckoutBeginError(e);
    console.error("[paypal] contact register failed", e);
    return NextResponse.json(
      { error: mapped.error, message: mapped.message },
      { status: mapped.status }
    );
  }

  const checkoutReference = encodeCheckoutReference(contactId, planId);

  try {
    const accessToken = await getPayPalAccessToken();
    const { id } = await createPayPalOrderRequest({
      accessToken,
      planId: plan.id,
      checkoutReference,
      planTitle: plan.title,
      sessions: plan.sessions,
      amountValue,
      currencyCode: PAYPAL_CURRENCY,
      itemTotalValue,
      handlingValue,
    });

    return NextResponse.json({
      orderID: id,
      contactId,
      checkoutReference,
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
