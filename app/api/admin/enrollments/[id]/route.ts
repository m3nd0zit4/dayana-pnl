import { NextResponse } from "next/server";
import { EnrollmentStatus } from "@prisma/client";
import { apiError, readJson, withStaff } from "@/lib/api/handler";
import { fireAuditLog } from "@/lib/crm/audit";
import {
  EnrollmentValidationError,
  deleteEnrollment,
  getEnrollmentById,
  updateEnrollmentStatus,
} from "@/lib/crm/enrollments";
import { prisma } from "@/lib/db";

type Params = { id: string };

export const dynamic = "force-dynamic";

export const GET = withStaff<Params>("read", async ({ params }) => {
  const { id } = params;
  const enrollment = await getEnrollmentById(id);
  if (!enrollment) {
    return apiError("not_found", 404);
  }
  return NextResponse.json({ enrollment });
});

export const PATCH = withStaff<Params>("write", async ({ req, staff, params }) => {
  const { id } = params;
  const body = await readJson(req);

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
      return apiError("not_found", 404);
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
        },
      });
    }
  } catch (e) {
    if (e instanceof EnrollmentValidationError) {
      return apiError(e.code, 409);
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
});

export const DELETE = withStaff<Params>("write", async ({ staff, params }) => {
  const { id } = params;

  try {
    await deleteEnrollment(id);
  } catch (e) {
    if (e instanceof EnrollmentValidationError) {
      const status = e.code === "NOT_FOUND" ? 404 : 409;
      return apiError(e.code, status);
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
});
