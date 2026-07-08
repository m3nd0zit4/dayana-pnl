import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { hashPassword } from "@/lib/auth/password";
import { validateStaffPassword } from "@/lib/auth/password-policy";
import { consumeMemberAuthToken } from "@/lib/auth/member-tokens";
import { revokeAllMemberSessions } from "@/lib/auth/member-sessions";
import { setMemberPassword } from "@/lib/crm/member-accounts";
import { clientIp, rateLimitDistributed } from "@/lib/api/rate-limit-distributed";
import { writeAuditLog } from "@/lib/crm/audit";
import { setPasswordSchema } from "@/lib/validations/member";

export const dynamic = "force-dynamic";

export const POST = async (req: Request) => {
  const rate = await rateLimitDistributed(
    `member-set-password:${clientIp(req)}`,
    10,
    15 * 60_000
  );
  if (!rate.ok) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  const parsed = setPasswordSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const policy = validateStaffPassword(parsed.data.password);
  if (!policy.ok) {
    return NextResponse.json(
      { error: "weak_password", message: policy.error },
      { status: 400 }
    );
  }

  const contactId = await consumeMemberAuthToken(parsed.data.token);
  if (!contactId) {
    return NextResponse.json({ error: "invalid_token" }, { status: 400 });
  }

  const passwordHash = await hashPassword(parsed.data.password);
  const account = await setMemberPassword(contactId, passwordHash);
  // A fresh password invalidates every existing session (esp. after a reset).
  await revokeAllMemberSessions(account.id).catch(() => undefined);

  await writeAuditLog({
    action: "MEMBER_PASSWORD_SET",
    entityType: "MemberAccount",
    entityId: account.id,
  }).catch(() => undefined);

  const contact = await prisma.contact.findUnique({
    where: { id: contactId },
    select: { email: true },
  });

  return NextResponse.json({ ok: true, email: contact?.email ?? null });
};
