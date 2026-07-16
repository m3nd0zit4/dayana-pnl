import { NextResponse } from "next/server";
import { createMemberAuthToken } from "@/lib/auth/member-tokens";
import {
  getMemberByEmail,
  getOrCreateContactForEmailSignup,
} from "@/lib/crm/member-accounts";
import { clientIp, rateLimitDistributed } from "@/lib/api/rate-limit-distributed";
import {
  sendMemberInviteEmail,
  sendMemberPasswordResetEmail,
} from "@/lib/notifications/member-emails";
import { requestAccessSchema } from "@/lib/validations/member";

export const dynamic = "force-dynamic";

/**
 * Open self-service signup + "forgot password", in one endpoint: an unknown
 * email creates a new lead Contact and gets an invite link; a known email
 * without a password yet gets the same invite link; a known email that
 * already has a password gets a reset link. No prior enrollment/payment is
 * required to create the account — course content itself is gated
 * separately (membership.isCurrent) once the member is logged in.
 *
 * Always answers { ok: true } (never { error: "STAFF_EMAIL..." } etc.) so
 * the endpoint can't be used to enumerate which emails belong to staff.
 */
export const POST = async (req: Request) => {
  const ip = clientIp(req);
  const rate = await rateLimitDistributed(
    `member-request-access:${ip}`,
    5,
    15 * 60_000
  );
  if (!rate.ok) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  const parsed = requestAccessSchema.safeParse(
    await req.json().catch(() => null)
  );
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const email = parsed.data.email.trim().toLowerCase();
  const emailRate = await rateLimitDistributed(
    `member-request-access-email:${email}`,
    3,
    15 * 60_000
  );
  if (!emailRate.ok) {
    return NextResponse.json({ ok: true });
  }

  const member = await getMemberByEmail(email);
  const callbackUrl = parsed.data.callbackUrl ?? null;

  let contactId: string;
  let firstName: string;
  let isReset: boolean;

  if (member) {
    contactId = member.contact.id;
    firstName = member.contact.firstName;
    isReset = Boolean(member.account?.passwordHash);
  } else {
    try {
      const contact = await getOrCreateContactForEmailSignup(
        email,
        parsed.data.name
      );
      contactId = contact.id;
      firstName = contact.firstName;
      isReset = false;
    } catch {
      // Staff email (or any other creation failure) — pretend it worked.
      return NextResponse.json({ ok: true });
    }
  }

  const rawToken = await createMemberAuthToken({
    contactId,
    purpose: isReset ? "PASSWORD_RESET" : "INVITE",
  });

  const payload = { contactId, firstName, rawToken, callbackUrl };
  if (isReset) {
    await sendMemberPasswordResetEmail(payload);
  } else {
    await sendMemberInviteEmail(payload);
  }

  return NextResponse.json({ ok: true });
};
