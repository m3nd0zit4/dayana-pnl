import { NextResponse } from "next/server";
import { apiError, readJson, withStaff } from "@/lib/api/handler";
import { fireAuditLog } from "@/lib/crm/audit";
import { setMembershipPaidUntil } from "@/lib/lms/membership";
import { membershipPaidUntilSchema } from "@/lib/validations/admin";

export const dynamic = "force-dynamic";

type Params = { id: string };

export const PATCH = withStaff<Params>("manualPayment", async ({ req, staff, params }) => {
  const { id: enrollmentId } = params;
  const parsed = membershipPaidUntilSchema.safeParse(await readJson(req));
  if (!parsed.success) {
    return apiError("invalid_body", 400);
  }

  const paidUntil = parsed.data.paidUntil
    ? new Date(parsed.data.paidUntil)
    : null;

  const enrollment = await setMembershipPaidUntil(enrollmentId, paidUntil).catch(
    () => null
  );
  if (!enrollment) {
    return apiError("not_found", 404);
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
});
