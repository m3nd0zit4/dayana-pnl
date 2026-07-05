import { NextResponse } from "next/server";
import { EnrollmentStatus, ProductKind } from "@prisma/client";
import { prisma } from "@/lib/db";
import { createMemberAuthToken } from "@/lib/auth/member-tokens";
import { getMemberByEmail } from "@/lib/crm/member-accounts";
import { clientIp, rateLimitDistributed } from "@/lib/api/rate-limit-distributed";
import {
  sendMemberInviteEmail,
  sendMemberPasswordResetEmail,
} from "@/lib/notifications/member-emails";
import { requestAccessSchema } from "@/lib/validations/member";

export const dynamic = "force-dynamic";

/**
 * Always answers { ok: true } so the endpoint can't be used to enumerate
 * which emails exist. Sends an invite (no password yet) or a reset link.
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
  if (!member) {
    return NextResponse.json({ ok: true });
  }

  const hasCourseEnrollment = await prisma.enrollment.findFirst({
    where: {
      contactId: member.contact.id,
      product: { kind: ProductKind.COURSE },
      status: {
        in: [EnrollmentStatus.ACTIVE, EnrollmentStatus.COMPLETED],
      },
    },
    select: { id: true },
  });

  if (!member.account && !hasCourseEnrollment) {
    return NextResponse.json({ ok: true });
  }

  const isReset = Boolean(member.account?.passwordHash);
  const rawToken = await createMemberAuthToken({
    contactId: member.contact.id,
    purpose: isReset ? "PASSWORD_RESET" : "INVITE",
  });

  const payload = {
    contactId: member.contact.id,
    firstName: member.contact.firstName,
    rawToken,
  };
  if (isReset) {
    await sendMemberPasswordResetEmail(payload);
  } else {
    await sendMemberInviteEmail(payload);
  }

  return NextResponse.json({ ok: true });
};
