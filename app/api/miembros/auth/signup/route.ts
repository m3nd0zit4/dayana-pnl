import { NextResponse } from "next/server";
import type { CountryCode } from "libphonenumber-js";
import { prisma } from "@/lib/db";
import { getMemberByEmail } from "@/lib/crm/member-accounts";
import { setMemberPassword } from "@/lib/crm/member-accounts";
import { getStaffByEmail } from "@/lib/crm/staff";
import { writeAuditLog } from "@/lib/crm/audit";
import { hashPassword } from "@/lib/auth/password";
import { validateStaffPassword } from "@/lib/auth/password-policy";
import { normalizePhoneWithCountry } from "@/lib/phone";
import { clientIp, rateLimitDistributed } from "@/lib/api/rate-limit-distributed";
import { signupSchema } from "@/lib/validations/member";
import { ContactSource } from "@prisma/client";

export const dynamic = "force-dynamic";

/**
 * Direct signup from the onboarding wizard: the whole profile (email, name,
 * phone, password, consent) arrives at once and the account is usable
 * immediately — the client signs in right after. Unlike request-access there
 * is no emailed verification link in this path (accepted product decision:
 * the wizard is the checkout-friendly flow; `emailVerifiedAt` is stamped by
 * setMemberPassword). request-access remains for recovery/invites.
 */
export const POST = async (req: Request) => {
  const ip = clientIp(req);
  const rate = await rateLimitDistributed(
    `member-signup:${ip}`,
    5,
    15 * 60_000
  );
  if (!rate.ok) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  const parsed = signupSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const email = parsed.data.email.trim().toLowerCase();
  const emailRate = await rateLimitDistributed(
    `member-signup-email:${email}`,
    3,
    15 * 60_000
  );
  if (!emailRate.ok) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  const passwordCheck = validateStaffPassword(parsed.data.password);
  if (!passwordCheck.ok) {
    return NextResponse.json(
      { error: "weak_password", message: passwordCheck.error },
      { status: 400 }
    );
  }

  const normalized = normalizePhoneWithCountry(
    parsed.data.phone,
    parsed.data.phoneCountry.toUpperCase() as CountryCode
  );
  if (!normalized) {
    return NextResponse.json({ error: "invalid_phone" }, { status: 400 });
  }

  const staff = await getStaffByEmail(email);
  if (staff) {
    // Staff must use credentials at /acceso — never self-signup.
    return NextResponse.json({ error: "email_taken" }, { status: 409 });
  }

  const firstName = parsed.data.firstName.trim();
  const lastName = parsed.data.lastName?.trim() || null;
  const displayName = [firstName, lastName].filter(Boolean).join(" ");

  const member = await getMemberByEmail(email);
  const phoneOwner = await prisma.contact.findUnique({
    where: { phoneE164: normalized.phoneE164 },
    include: { memberAccount: { select: { id: true } } },
  });

  let contactId: string;

  if (member) {
    if (member.account?.passwordHash || member.account?.googleSub) {
      return NextResponse.json({ error: "email_taken" }, { status: 409 });
    }
    // Lead/invited contact without a working account — adopt it.
    if (phoneOwner && phoneOwner.id !== member.contact.id) {
      return NextResponse.json({ error: "phone_taken" }, { status: 409 });
    }
    const updated = await prisma.contact.update({
      where: { id: member.contact.id },
      data: {
        firstName,
        lastName,
        displayName,
        phoneE164: normalized.phoneE164,
        phoneCountryIso: normalized.phoneCountryIso ?? null,
        consentDataAt: new Date(),
      },
    });
    contactId = updated.id;
  } else if (phoneOwner) {
    // Phone already known. Adopt that contact only when it can't collide
    // with someone else's identity: no member account and no different email.
    if (phoneOwner.memberAccount || (phoneOwner.email && phoneOwner.email !== email)) {
      return NextResponse.json({ error: "phone_taken" }, { status: 409 });
    }
    const updated = await prisma.contact.update({
      where: { id: phoneOwner.id },
      data: {
        email,
        firstName,
        lastName,
        displayName,
        consentDataAt: new Date(),
      },
    });
    contactId = updated.id;
  } else {
    const createdContact = await prisma.contact.create({
      data: {
        email,
        firstName,
        lastName,
        displayName,
        phoneE164: normalized.phoneE164,
        phoneCountryIso: normalized.phoneCountryIso ?? null,
        source: ContactSource.WEB,
        sourceDetail: "member-signup-wizard",
        consentDataAt: new Date(),
      },
    });
    contactId = createdContact.id;
  }

  const account = await setMemberPassword(
    contactId,
    await hashPassword(parsed.data.password)
  );

  await writeAuditLog({
    action: "MEMBER_SIGNUP",
    entityType: "MemberAccount",
    entityId: account.id,
    changes: { contactId, source: "wizard" },
  }).catch(() => undefined);

  return NextResponse.json({ ok: true, email });
};
