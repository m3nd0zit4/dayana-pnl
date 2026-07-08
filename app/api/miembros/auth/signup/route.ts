import { NextResponse } from "next/server";
import { z } from "zod";
import { hashPassword } from "@/lib/auth/password";
import { validateStaffPassword } from "@/lib/auth/password-policy";
import {
  getMemberByEmail,
  getOrCreateContactForEmailSignup,
  setMemberPassword,
} from "@/lib/crm/member-accounts";
import { clientIp, rateLimitDistributed } from "@/lib/api/rate-limit-distributed";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

/**
 * Open, direct signup: creates the account (and the lead Contact, if the
 * email is new) with a password right away — no email round-trip required.
 * The old invite-link flow (request-access) still exists for password
 * resets and staff-sent invites, but account creation no longer depends on
 * an email actually arriving.
 */
export const POST = async (req: Request) => {
  const ip = clientIp(req);
  const rate = await rateLimitDistributed(`member-signup:${ip}`, 8, 15 * 60_000);
  if (!rate.ok) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const email = parsed.data.email.trim().toLowerCase();
  const emailRate = await rateLimitDistributed(
    `member-signup-email:${email}`,
    5,
    15 * 60_000
  );
  if (!emailRate.ok) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  const policy = validateStaffPassword(parsed.data.password);
  if (!policy.ok) {
    return NextResponse.json(
      { error: "weak_password", message: policy.error },
      { status: 400 }
    );
  }

  const existing = await getMemberByEmail(email);
  if (existing?.account?.passwordHash) {
    return NextResponse.json({ error: "already_registered" }, { status: 409 });
  }

  let contactId: string;
  try {
    if (existing) {
      contactId = existing.contact.id;
    } else {
      const contact = await getOrCreateContactForEmailSignup(email);
      contactId = contact.id;
    }
  } catch {
    // Staff email — do not create a member account for it.
    return NextResponse.json({ error: "email_not_available" }, { status: 409 });
  }

  const passwordHash = await hashPassword(parsed.data.password);
  await setMemberPassword(contactId, passwordHash);

  return NextResponse.json({ ok: true });
};
