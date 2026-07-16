import { NextResponse } from "next/server";
import { resolveMember } from "@/lib/auth/api-member";
import { requestMemberAccountDeletion } from "@/lib/crm/member-accounts";
import { writeAuditLog } from "@/lib/crm/audit";

export const dynamic = "force-dynamic";

export const POST = async () => {
  const member = await resolveMember();
  if (member instanceof NextResponse) return member;

  await requestMemberAccountDeletion(member.contact.id);

  await writeAuditLog({
    action: "MEMBER_DELETION_REQUESTED",
    entityType: "Contact",
    entityId: member.contact.id,
  }).catch(() => undefined);

  return NextResponse.json({ ok: true });
};
