import { NextRequest, NextResponse } from "next/server";
import {
  beginCheckoutContact,
  mapCheckoutBeginError,
  type CheckoutContactBody,
} from "@/lib/crm/checkout-enrollment";
import { isPlanId } from "@/lib/plans";
import { isActivePlanId } from "@/lib/plans-from-db";
import {
  clientIp,
  rateLimitDistributed,
} from "@/lib/api/rate-limit-distributed";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = CheckoutContactBody & {
  planId?: string;
};

export async function POST(req: NextRequest) {
  const ip = clientIp(req);
  const rl = await rateLimitDistributed(`checkout:${ip}`, 60, 60_000);
  if (!rl.ok) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  if (!body.planId || !isPlanId(body.planId) || !(await isActivePlanId(body.planId))) {
    return NextResponse.json({ error: "invalid_plan" }, { status: 400 });
  }

  try {
    const { contactId, contactCreated } = await beginCheckoutContact({
      planId: body.planId,
      contact: {
        phone: body.phone,
        phoneCountry: body.phoneCountry,
        firstName: body.firstName,
        lastName: body.lastName,
        email: body.email,
        consentData: body.consentData === true,
      },
    });

    return NextResponse.json({
      contactId,
      contactCreated,
      productId: body.planId,
    });
  } catch (e) {
    const mapped = mapCheckoutBeginError(e);
    console.error("[checkout/enrollment]", e instanceof Error ? e.message : String(e));
    return NextResponse.json(
      { error: mapped.error, message: mapped.message },
      { status: mapped.status }
    );
  }
}
