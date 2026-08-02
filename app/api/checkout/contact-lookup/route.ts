import { NextResponse } from "next/server";
import { clientIp, rateLimitDistributed } from "@/lib/api/rate-limit-distributed";
import { lookupContactPrefillByEmail } from "@/lib/crm/contacts";
import { lookupContactSchema } from "@/lib/validations/checkout-contact";

export const dynamic = "force-dynamic";

/**
 * Anonymous-checkout autofill: lets a returning buyer's name/phone-country
 * prefill without signing in. Mild enumeration surface (same trade-off as
 * /api/miembros/auth/email-status) — kept behind tight per-IP and per-email
 * rate limits, and the response never includes the phone number itself.
 */
export const POST = async (req: Request) => {
  const ip = clientIp(req);
  const rate = await rateLimitDistributed(`checkout-contact-lookup:${ip}`, 10, 15 * 60_000);
  if (!rate.ok) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  const parsed = lookupContactSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const email = parsed.data.email.trim().toLowerCase();
  const emailRate = await rateLimitDistributed(
    `checkout-contact-lookup-email:${email}`,
    5,
    15 * 60_000
  );
  if (!emailRate.ok) {
    // Rate-limited on this address: answer as "not found" rather than an
    // error, so this can't be used to distinguish "known email, throttled"
    // from "unknown email" via response shape.
    return NextResponse.json({ found: false });
  }

  const prefill = await lookupContactPrefillByEmail(email);
  if (!prefill) {
    return NextResponse.json({ found: false });
  }

  return NextResponse.json({ found: true, prefill });
};
