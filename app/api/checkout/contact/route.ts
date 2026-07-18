import { NextRequest, NextResponse } from "next/server";
import {
  beginCheckoutContact,
  mapCheckoutBeginError,
  type CheckoutContactBody,
} from "@/lib/crm/checkout-enrollment";
import { resolveSessionCheckoutContact } from "@/lib/crm/checkout-session-contact";
import {
  clientIp,
  rateLimitDistributed,
} from "@/lib/api/rate-limit-distributed";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = CheckoutContactBody & {
  planId?: string;
  /** Resolve the contact from the signed-in session instead of (or anchored
   *  to) the posted fields. Server-side only — posted contactId is ignored. */
  fromSession?: boolean;
};

export async function POST(req: NextRequest) {
  const ip = clientIp(req);
  const rl = await rateLimitDistributed(`checkout:contact:${ip}`, 60, 60_000);
  if (!rl.ok) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  if (!body.planId?.trim()) {
    return NextResponse.json({ error: "invalid_plan" }, { status: 400 });
  }

  let sessionContactId: string | undefined;
  if (body.fromSession === true) {
    const resolved = await resolveSessionCheckoutContact();
    if (!resolved) {
      return NextResponse.json({ error: "no_session" }, { status: 401 });
    }

    const hasFields = Boolean(body.phone?.trim());
    if (!hasFields) {
      if (resolved.status === "complete") {
        return NextResponse.json({
          contactId: resolved.contactId,
          complete: true,
          prefill: resolved.prefill,
        });
      }
      return NextResponse.json({ complete: false, prefill: resolved.prefill });
    }

    // Fallback-form submit: anchor to the session contact so the payment
    // registers to the signed-in identity, never a client-chosen id.
    sessionContactId = resolved.contactId ?? undefined;
  }

  try {
    const { contactId, contactCreated } = await beginCheckoutContact({
      planId: body.planId,
      contact: {
        ...(sessionContactId ? { contactId: sessionContactId } : {}),
        phone: body.phone,
        phoneCountry: body.phoneCountry,
        firstName: body.firstName,
        lastName: body.lastName,
        email: body.email,
        consentData: body.consentData === true,
      },
    });

    return NextResponse.json({ contactId, contactCreated, productId: body.planId });
  } catch (e) {
    const mapped = mapCheckoutBeginError(e);
    console.error("[checkout/contact]", e);
    return NextResponse.json(
      { error: mapped.error, message: mapped.message },
      { status: mapped.status }
    );
  }
}
