import { NextRequest, NextResponse } from "next/server";
import { requireWriteStaff } from "@/lib/auth/api-staff";
import { fireAuditLog } from "@/lib/crm/audit";
import { reorderCourseClasses } from "@/lib/lms/course-admin";
import { reorderCourseClassesSchema } from "@/lib/validations/admin";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const staff = await requireWriteStaff();
  if (staff instanceof NextResponse) return staff;

  const parsed = reorderCourseClassesSchema.safeParse(
    await req.json().catch(() => null)
  );
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  await reorderCourseClasses(parsed.data.moduleId, parsed.data.orderedIds);

  fireAuditLog({
    staffUserId: staff.id,
    action: "REORDER",
    entityType: "LiveClassSession",
    entityId: parsed.data.moduleId,
  });

  return NextResponse.json({ ok: true });
}
