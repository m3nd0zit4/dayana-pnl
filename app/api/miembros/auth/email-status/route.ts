import { NextResponse } from "next/server";
import { getMemberByEmail } from "@/lib/crm/member-accounts";
import { getStaffByEmail } from "@/lib/crm/staff";
import { clientIp, rateLimitDistributed } from "@/lib/api/rate-limit-distributed";
import { emailStatusSchema } from "@/lib/validations/member";

export const dynamic = "force-dynamic";

/**
 * Wizard step 1 helper: tells the signup flow whether an email should flip
 * to login ("login"), hint at Google ("google"), or continue as a new
 * registration ("new"). Mild enumeration surface — accepted product
 * decision; kept behind tight per-IP and per-email rate limits.
 */
export const POST = async (req: Request) => {
  const ip = clientIp(req);
  const rate = await rateLimitDistributed(
    `member-email-status:${ip}`,
    10,
    15 * 60_000
  );
  if (!rate.ok) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  const parsed = emailStatusSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const email = parsed.data.email.trim().toLowerCase();
  const emailRate = await rateLimitDistributed(
    `member-email-status-email:${email}`,
    5,
    15 * 60_000
  );
  if (!emailRate.ok) {
    // Rate-limited on this address: let the wizard continue; the signup
    // endpoint still enforces conflicts at submit time.
    return NextResponse.json({ status: "new" });
  }

  const staff = await getStaffByEmail(email);
  if (staff) {
    return NextResponse.json({ status: "login" });
  }

  const member = await getMemberByEmail(email);
  if (member?.account?.passwordHash) {
    return NextResponse.json({ status: "login" });
  }
  if (member?.account?.googleSub) {
    return NextResponse.json({ status: "google" });
  }

  return NextResponse.json({ status: "new" });
};
