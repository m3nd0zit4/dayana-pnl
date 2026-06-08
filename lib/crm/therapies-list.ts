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
  nextSessionAt: string | null;
  nextSessionNumber: number | null;
};

const mapEnrollment = (
  e: Awaited<ReturnType<typeof fetchTherapyEnrollments>>[number]
): TherapyListRow => {
  const nextSession = e.therapyPackage?.sessions[0] ?? null;
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
    nextSessionAt: nextSession?.scheduledAt?.toISOString() ?? null,
    nextSessionNumber: nextSession?.sessionNumber ?? null,
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
            where: {
              status: "SCHEDULED",
              scheduledAt: { not: null },
            },
            orderBy: { scheduledAt: "asc" },
            take: 1,
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
