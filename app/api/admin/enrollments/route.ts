import { NextRequest, NextResponse } from "next/server";
import { EnrollmentStatus } from "@prisma/client";
import { resolveAdminStaff, requireWriteStaff } from "@/lib/auth/api-staff";
import { writeAuditLog } from "@/lib/crm/audit";
import { createEnrollment } from "@/lib/crm/enrollments";
import { listEnrollmentsAdmin } from "@/lib/crm/enrollments-list";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const started = Date.now();
  const staff = await resolveAdminStaff();
  if (staff instanceof NextResponse) return staff;

  const status = req.nextUrl.searchParams.get("status") ?? undefined;
  const q = req.nextUrl.searchParams.get("q")?.trim() ?? "";
  const cursor = req.nextUrl.searchParams.get("cursor") ?? undefined;

  const enrollments = await listEnrollmentsAdmin({
    status,
    q,
    cursor,
    limit: 100,
  });

  if (process.env.NODE_ENV === "development") {
    console.log(
      `[api] GET /api/admin/enrollments ${Date.now() - started}ms (${enrollments.length} rows)`
    );
  }

  const nextCursor =
    enrollments.length === 100 ? enrollments[enrollments.length - 1]?.id : null;

  return NextResponse.json({ enrollments, nextCursor });
}

export async function POST(req: NextRequest) {
  const staff = await requireWriteStaff();
  if (staff instanceof NextResponse) return staff;

  const body = await req.json().catch(() => null);
  if (!body?.contactId || !body?.productId) {
    return NextResponse.json({ error: "missing_fields" }, { status: 400 });
  }

  try {
    const enrollment = await createEnrollment({
      contactId: body.contactId,
      productId: body.productId,
      workshopEditionId: body.workshopEditionId,
      status: (body.status as EnrollmentStatus) ?? EnrollmentStatus.LEAD,
      label: body.label,
      isPrimary: body.isPrimary,
    });

    await writeAuditLog({
      staffUserId: staff.id,
      action: "CREATE",
      entityType: "Enrollment",
      entityId: enrollment.id,
    });

    return NextResponse.json({ enrollment });
  } catch (e) {
    const code = e instanceof Error && "code" in e ? String((e as { code: string }).code) : "error";
    return NextResponse.json({ error: code }, { status: 400 });
  }
}
