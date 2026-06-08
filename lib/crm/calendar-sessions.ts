import { TherapySessionStatus } from "@prisma/client";
import { prisma } from "../db";

export type CalendarSessionEvent = {
  id: string;
  sessionNumber: number;
  scheduledAt: string;
  durationMinutes: number;
  status: TherapySessionStatus;
  meetUrl: string | null;
  contact: {
    id: string;
    firstName: string;
    lastName: string | null;
    phoneE164: string;
    timezone: string;
  };
  enrollmentId: string;
  therapyPackageId: string;
  productTitle: string;
};

const CALENDAR_STATUSES: TherapySessionStatus[] = [
  TherapySessionStatus.SCHEDULED,
  TherapySessionStatus.RESCHEDULED,
];

export const listCalendarSessions = async (from: Date, to: Date) => {
  const sessions = await prisma.therapySession.findMany({
    where: {
      status: { in: CALENDAR_STATUSES },
      scheduledAt: { gte: from, lt: to },
    },
    orderBy: { scheduledAt: "asc" },
    select: {
      id: true,
      sessionNumber: true,
      scheduledAt: true,
      durationMinutes: true,
      status: true,
      meetUrl: true,
      therapyPackage: {
        select: {
          id: true,
          enrollmentId: true,
          enrollment: {
            select: {
              id: true,
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
            },
          },
        },
      },
    },
  });

  return sessions
    .filter((s) => s.scheduledAt != null)
    .map((s): CalendarSessionEvent => ({
      id: s.id,
      sessionNumber: s.sessionNumber,
      scheduledAt: s.scheduledAt!.toISOString(),
      durationMinutes: s.durationMinutes,
      status: s.status,
      meetUrl: s.meetUrl,
      contact: {
        id: s.therapyPackage.enrollment.contact.id,
        firstName: s.therapyPackage.enrollment.contact.firstName,
        lastName: s.therapyPackage.enrollment.contact.lastName,
        phoneE164: s.therapyPackage.enrollment.contact.phoneE164,
        timezone: s.therapyPackage.enrollment.contact.timezone,
      },
      enrollmentId: s.therapyPackage.enrollmentId,
      therapyPackageId: s.therapyPackage.id,
      productTitle: s.therapyPackage.enrollment.product.title,
    }));
};

export const listPendingScheduleSlots = async () => {
  const sessions = await prisma.therapySession.findMany({
    where: { status: TherapySessionStatus.PENDING_SCHEDULE },
    orderBy: [{ therapyPackage: { enrollment: { updatedAt: "desc" } } }, { sessionNumber: "asc" }],
    select: {
      id: true,
      sessionNumber: true,
      therapyPackageId: true,
      therapyPackage: {
        select: {
          meetDefaultUrl: true,
          enrollmentId: true,
          enrollment: {
            select: {
              contact: {
                select: {
                  id: true,
                  firstName: true,
                  lastName: true,
                  timezone: true,
                },
              },
              product: { select: { title: true } },
            },
          },
        },
      },
    },
  });

  return sessions.map((s) => ({
    sessionId: s.id,
    sessionNumber: s.sessionNumber,
    therapyPackageId: s.therapyPackageId,
    enrollmentId: s.therapyPackage.enrollmentId,
    meetDefaultUrl: s.therapyPackage.meetDefaultUrl,
    contactName: `${s.therapyPackage.enrollment.contact.firstName} ${s.therapyPackage.enrollment.contact.lastName ?? ""}`.trim(),
    contactId: s.therapyPackage.enrollment.contact.id,
    contactTimezone: s.therapyPackage.enrollment.contact.timezone,
    productTitle: s.therapyPackage.enrollment.product.title,
  }));
};
