import { NextResponse } from "next/server";
import { apiError, withStaff } from "@/lib/api/handler";
import { createMemberAuthToken } from "@/lib/auth/member-tokens";
import { fireAuditLog } from "@/lib/crm/audit";
import { getMemberByContactId } from "@/lib/crm/member-accounts";
import { sendMemberInviteEmail } from "@/lib/notifications/member-emails";

export const dynamic = "force-dynamic";

type Params = { id: string };

export const POST = withStaff<Params>("write", async ({ staff, params }) => {
  const { id: contactId } = params;
  const member = await getMemberByContactId(contactId);
  if (!member) {
    return apiError("not_found", 404);
  }
  if (!member.contact.email) {
    return apiError("no_email", 400);
  }

  const rawToken = await createMemberAuthToken({
    contactId,
    purpose: "INVITE",
    createdByStaffId: staff.id,
  });

  const { result } = await sendMemberInviteEmail({
    contactId,
    firstName: member.contact.firstName,
    rawToken,
  });

  fireAuditLog({
    staffUserId: staff.id,
    action: "MEMBER_INVITED",
    entityType: "Contact",
    entityId: contactId,
    changes: { deliveryStatus: result.status },
  });

  return NextResponse.json({ ok: true, deliveryStatus: result.status });
});
