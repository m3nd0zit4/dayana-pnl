import { EnrollmentStatus, ProductKind } from "@prisma/client";
import { prisma } from "../db";

export type TherapyListRow = {
  enrollmentId: string;
  contactId: string;
  contactName: string;
  phoneE164: string;
  timezone: string;
  productTitle: string;
  status: string;
  sessionsUsed: number;
  sessionsTotal: number | null;
  therapyPackageId: string | null;
  meetDefaultUrl: string | null;
  nextSessionAt: string | null;
  nextSessionNumber: number | null;
  schedulableSessionNumber: number | null;
};

const mapEnrollment = (
  e: Awaited<ReturnType<typeof fetchTherapyEnrollments>>[number]
): TherapyListRow => {
  const sessions = e.therapyPackage?.sessions ?? [];
  const nextScheduled = sessions
    .filter(
      (s) =>
        s.scheduledAt &&
        (s.status === "SCHEDULED" || s.status === "RESCHEDULED")
    )
    .sort(
      (a, b) =>
        (a.scheduledAt?.getTime() ?? 0) - (b.scheduledAt?.getTime() ?? 0)
    )[0];
  const nextIncomplete = sessions.find((s) => s.status !== "COMPLETED");

  return {
    enrollmentId: e.id,
    contactId: e.contact.id,
    contactName: `${e.contact.firstName} ${e.contact.lastName ?? ""}`.trim(),
    phoneE164: e.contact.phoneE164,
    timezone: e.contact.timezone,
    productTitle: e.product.title,
    status: e.status,
    sessionsUsed: e.sessionsUsed,
    sessionsTotal: e.sessionsTotal,
    therapyPackageId: e.therapyPackage?.id ?? null,
    meetDefaultUrl: e.therapyPackage?.meetDefaultUrl ?? null,
    nextSessionAt: nextScheduled?.scheduledAt?.toISOString() ?? null,
    nextSessionNumber: nextScheduled?.sessionNumber ?? null,
    schedulableSessionNumber:
      nextScheduled?.sessionNumber ?? nextIncomplete?.sessionNumber ?? null,
  };
};

const fetchTherapyEnrollments = (statuses: EnrollmentStatus[]) =>
  prisma.enrollment.findMany({
    where: {
      status: { in: statuses },
      product: { kind: ProductKind.THERAPY },
    },
    orderBy: { updatedAt: "desc" },
    include: {
      contact: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          phoneE164: true,
          timezone: true,
        },
      },
      product: { select: { title: true } },
      therapyPackage: {
        include: {
          sessions: {
            orderBy: { sessionNumber: "asc" },
            select: {
              sessionNumber: true,
              status: true,
              scheduledAt: true,
            },
          },
        },
      },
    },
  });

export const listActiveTherapies = async (): Promise<TherapyListRow[]> => {
  const enrollments = await fetchTherapyEnrollments([
    EnrollmentStatus.ACTIVE,
    EnrollmentStatus.PENDING_PAYMENT,
  ]);
  return enrollments.map(mapEnrollment);
};

export const listTherapyLeads = async (): Promise<TherapyListRow[]> => {
  const enrollments = await fetchTherapyEnrollments([EnrollmentStatus.LEAD]);
  return enrollments.map(mapEnrollment);
};
