import { NextRequest, NextResponse } from "next/server";
import { requireWriteStaff } from "@/lib/auth/api-staff";
import { fireAuditLog } from "@/lib/crm/audit";
import { updateTherapyPackage } from "@/lib/crm/therapy";

export const dynamic = "force-dynamic";

export async function PATCH(req: NextRequest) {
  const staff = await requireWriteStaff();
  if (staff instanceof NextResponse) return staff;

  const body = await req.json().catch(() => null);
  if (!body?.therapyPackageId) {
    return NextResponse.json({ error: "missing_fields" }, { status: 400 });
  }

  const pkg = await updateTherapyPackage(body.therapyPackageId, {
    meetDefaultUrl: body.meetDefaultUrl,
    reprogrammingNotes: body.reprogrammingNotes,
  });

  fireAuditLog({
    staffUserId: staff.id,
    action: "UPDATE",
    entityType: "TherapyPackage",
    entityId: pkg.id,
    changes: body,
  });

  return NextResponse.json({ therapyPackage: pkg });
}
