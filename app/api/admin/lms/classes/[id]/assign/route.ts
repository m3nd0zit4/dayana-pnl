import { NextRequest, NextResponse } from "next/server";
import { requireWriteStaff } from "@/lib/auth/api-staff";
import { fireAuditLog } from "@/lib/crm/audit";
import { assignClassToModule } from "@/lib/lms/course-admin";
import { assignClassModuleSchema } from "@/lib/validations/admin";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: RouteParams) {
  const staff = await requireWriteStaff();
  if (staff instanceof NextResponse) return staff;

  const { id } = await params;
  const parsed = assignClassModuleSchema.safeParse(
    await req.json().catch(() => null)
  );
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const liveClass = await assignClassToModule(id, parsed.data.moduleId).catch(
    () => null
  );
  if (!liveClass) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  fireAuditLog({
    staffUserId: staff.id,
    action: "UPDATE",
    entityType: "LiveClassSession",
    entityId: id,
    changes: { moduleId: parsed.data.moduleId },
  });

  return NextResponse.json({ liveClass });
}
