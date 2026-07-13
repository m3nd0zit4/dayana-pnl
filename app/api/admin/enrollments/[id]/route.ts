import { NextRequest, NextResponse } from "next/server";
import { EnrollmentStatus } from "@prisma/client";
import { resolveAdminStaff, requireWriteStaff } from "@/lib/auth/api-staff";
import { fireAuditLog } from "@/lib/crm/audit";
import {
  EnrollmentValidationError,
  deleteEnrollment,
  getEnrollmentById,
  updateEnrollmentStatus,
} from "@/lib/crm/enrollments";
import { prisma } from "@/lib/db";

type Ctx = { params: Promise<{ id: string }> };

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, ctx: Ctx) {
  const staff = await resolveAdminStaff();
  if (staff instanceof NextResponse) return staff;

  const { id } = await ctx.params;
  const enrollment = await getEnrollmentById(id);
  if (!enrollment) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  return NextResponse.json({ enrollment });
}

export async function PATCH(req: NextRequest, ctx: Ctx) {
  const staff = await requireWriteStaff();
  if (staff instanceof NextResponse) return staff;

  const { id } = await ctx.params;
  const body = await req.json().catch(() => null);

  const hasMetaUpdate =
    body?.label !== undefined ||
    body?.isPrimary !== undefined ||
    body?.sessionsUsed !== undefined;

  let enrollment;
  try {
    if (body?.status) {
      enrollment = await updateEnrollmentStatus(id, body.status as EnrollmentStatus);
    } else {
      enrollment = await getEnrollmentById(id);
    }
    if (!enrollment) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }

    if (hasMetaUpdate) {
      enrollment = await prisma.enrollment.update({
        where: { id },
        data: {
          label: body?.label ?? enrollment.label,
          isPrimary: body?.isPrimary ?? enrollment.isPrimary,
          sessionsUsed: body?.sessionsUsed ?? enrollment.sessionsUsed,
        },
        include: {
          product: true,
          contact: true,
          therapyPackage: { include: { sessions: { orderBy: { sessionNumber: "asc" } } } },
        },
      });
    }
  } catch (e) {
    if (e instanceof EnrollmentValidationError) {
      return NextResponse.json({ error: e.code }, { status: 409 });
    }
    throw e;
  }

  fireAuditLog({
    staffUserId: staff.id,
    action: "UPDATE",
    entityType: "Enrollment",
    entityId: id,
    changes: body,
  });

  return NextResponse.json({ enrollment });
}

export async function DELETE(_req: NextRequest, ctx: Ctx) {
  const staff = await requireWriteStaff();
  if (staff instanceof NextResponse) return staff;

  const { id } = await ctx.params;

  try {
    await deleteEnrollment(id);
  } catch (e) {
    if (e instanceof EnrollmentValidationError) {
      const status = e.code === "NOT_FOUND" ? 404 : 409;
      return NextResponse.json({ error: e.code }, { status });
    }
    throw e;
  }

  fireAuditLog({
    staffUserId: staff.id,
    action: "DELETE",
    entityType: "Enrollment",
    entityId: id,
  });

  return NextResponse.json({ ok: true });
}
