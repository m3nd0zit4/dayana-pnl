import { NextRequest, NextResponse } from "next/server";
import { requireWriteStaff } from "@/lib/auth/api-staff";
import { createMemberAuthToken } from "@/lib/auth/member-tokens";
import { fireAuditLog } from "@/lib/crm/audit";
import { getMemberByContactId } from "@/lib/crm/member-accounts";
import { sendMemberInviteEmail } from "@/lib/notifications/member-emails";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ id: string }> };

export async function POST(_req: NextRequest, { params }: RouteParams) {
  const staff = await requireWriteStaff();
  if (staff instanceof NextResponse) return staff;

  const { id: contactId } = await params;
  const member = await getMemberByContactId(contactId);
  if (!member) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (!member.contact.email) {
    return NextResponse.json({ error: "no_email" }, { status: 400 });
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
}
