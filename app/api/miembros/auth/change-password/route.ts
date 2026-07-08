import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { validateStaffPassword } from "@/lib/auth/password-policy";
import { revokeAllMemberSessionsExcept } from "@/lib/auth/member-sessions";
import { resolveMember } from "@/lib/auth/api-member";
import { setMemberPassword } from "@/lib/crm/member-accounts";
import { writeAuditLog } from "@/lib/crm/audit";
import { changePasswordSchema } from "@/lib/validations/member";

export const dynamic = "force-dynamic";

export const POST = async (req: Request) => {
  const member = await resolveMember();
  if (member instanceof NextResponse) return member;

  const parsed = changePasswordSchema.safeParse(
    await req.json().catch(() => null)
  );
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const policy = validateStaffPassword(parsed.data.newPassword);
  if (!policy.ok) {
    return NextResponse.json(
      { error: "weak_password", message: policy.error },
      { status: 400 }
    );
  }

  if (member.account.passwordHash) {
    const current = parsed.data.currentPassword ?? "";
    const valid = await verifyPassword(current, member.account.passwordHash);
    if (!valid) {
      return NextResponse.json({ error: "wrong_password" }, { status: 403 });
    }
  }

  const passwordHash = await hashPassword(parsed.data.newPassword);
  await setMemberPassword(member.contact.id, passwordHash);

  const session = await auth();
  await revokeAllMemberSessionsExcept(
    member.account.id,
    session?.user?.sessionId
  ).catch(() => undefined);

  await writeAuditLog({
    action: "MEMBER_PASSWORD_CHANGED",
    entityType: "MemberAccount",
    entityId: member.account.id,
  }).catch(() => undefined);

  return NextResponse.json({ ok: true });
};
