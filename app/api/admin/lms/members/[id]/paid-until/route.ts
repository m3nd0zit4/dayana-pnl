import { NextRequest, NextResponse } from "next/server";
import { requireManualPaymentStaff } from "@/lib/auth/api-staff";
import { fireAuditLog } from "@/lib/crm/audit";
import { setMembershipPaidUntil } from "@/lib/lms/membership";
import { membershipPaidUntilSchema } from "@/lib/validations/admin";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, { params }: RouteParams) {
  const staff = await requireManualPaymentStaff();
  if (staff instanceof NextResponse) return staff;

  const { id: enrollmentId } = await params;
  const parsed = membershipPaidUntilSchema.safeParse(
    await req.json().catch(() => null)
  );
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const paidUntil = parsed.data.paidUntil
    ? new Date(parsed.data.paidUntil)
    : null;

  const enrollment = await setMembershipPaidUntil(enrollmentId, paidUntil).catch(
    () => null
  );
  if (!enrollment) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  fireAuditLog({
    staffUserId: staff.id,
    action: "MEMBERSHIP_ADJUSTED",
    entityType: "Enrollment",
    entityId: enrollmentId,
    changes: { paidUntil: parsed.data.paidUntil },
  });

  return NextResponse.json({
    enrollment: { id: enrollment.id, paidUntil: enrollment.paidUntil },
  });
}
