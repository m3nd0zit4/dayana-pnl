import { NextRequest, NextResponse } from "next/server";
import { requireWriteStaff, resolveAdminStaff } from "@/lib/auth/api-staff";
import { writeAuditLog } from "@/lib/crm/audit";
import {
  completeTherapySession,
  markTherapySessionNoShow,
  scheduleTherapySession,
  updateTherapySession,
} from "@/lib/crm/therapy";
import { canEditClinicalNotes } from "@/lib/crm/staff";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const staff = await requireWriteStaff();
  if (staff instanceof NextResponse) return staff;

  const body = await req.json().catch(() => null);
  if (!body?.therapyPackageId || !body?.sessionNumber) {
    return NextResponse.json({ error: "missing_fields" }, { status: 400 });
  }

  try {
    if (body.action === "complete") {
      if (body.noteText && !canEditClinicalNotes(staff.role)) {
        return NextResponse.json({ error: "forbidden_notes" }, { status: 403 });
      }
      const session = await completeTherapySession(body.sessionId, {
        bodyText: body.noteText,
        title: body.noteTitle,
        createdByStaffId: staff.id,
      });
      await writeAuditLog({
        staffUserId: staff.id,
        action: "COMPLETE",
        entityType: "TherapySession",
        entityId: body.sessionId,
      });
      return NextResponse.json({ session });
    }

    if (!body.scheduledAt) {
      return NextResponse.json({ error: "missing_scheduled_at" }, { status: 400 });
    }

    const session = await scheduleTherapySession({
      therapyPackageId: body.therapyPackageId,
      sessionNumber: Number(body.sessionNumber),
      scheduledAt: new Date(body.scheduledAt),
      meetUrl: body.meetUrl,
      durationMinutes: body.durationMinutes,
    });

    await writeAuditLog({
      staffUserId: staff.id,
      action: "SCHEDULE",
      entityType: "TherapySession",
      entityId: session.id,
    });

    return NextResponse.json({ session });
  } catch (e) {
    const message = e instanceof Error ? e.message : "error";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function PATCH(req: NextRequest) {
  const staff = await requireWriteStaff();
  if (staff instanceof NextResponse) return staff;

  const body = await req.json().catch(() => null);
  if (!body?.sessionId) {
    return NextResponse.json({ error: "missing_fields" }, { status: 400 });
  }

  try {
    if (body.action === "no_show") {
      const session = await markTherapySessionNoShow(body.sessionId);
      await writeAuditLog({
        staffUserId: staff.id,
        action: "NO_SHOW",
        entityType: "TherapySession",
        entityId: body.sessionId,
      });
      return NextResponse.json({ session });
    }

    const session = await updateTherapySession(body.sessionId, {
      scheduledAt: body.scheduledAt ? new Date(body.scheduledAt) : undefined,
      meetUrl: body.meetUrl,
      durationMinutes: body.durationMinutes,
    });

    await writeAuditLog({
      staffUserId: staff.id,
      action: "UPDATE",
      entityType: "TherapySession",
      entityId: body.sessionId,
      changes: body,
    });

    return NextResponse.json({ session });
  } catch (e) {
    const message = e instanceof Error ? e.message : "error";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function GET(req: NextRequest) {
  const staff = await resolveAdminStaff();
  if (staff instanceof NextResponse) return staff;

  const enrollmentId = req.nextUrl.searchParams.get("enrollmentId");
  if (!enrollmentId) {
    return NextResponse.json({ error: "missing_enrollment_id" }, { status: 400 });
  }

  const { getTherapyPackageByEnrollment } = await import("@/lib/crm/therapy");
  const pkg = await getTherapyPackageByEnrollment(enrollmentId);
  return NextResponse.json({ therapyPackage: pkg });
}
