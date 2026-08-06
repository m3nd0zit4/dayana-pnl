import { EnrollmentStatus, ProductKind, TherapySessionStatus } from "@prisma/client";
import { fireNotification } from "@/lib/notifications/platform/emit";
import { formatInstantForContact } from "@/lib/datetime/visitor-schedule";
import { prisma } from "../db";

const contactName = (contact: {
  displayName: string | null;
  firstName: string;
}): string => contact.displayName ?? contact.firstName;

const formatSessionMoment = (
  at: Date,
  contact?: {
    timezone?: string | null;
    countryIso?: string | null;
    phoneCountryIso?: string | null;
  }
): string => {
  const f = formatInstantForContact(at, {
    timezone: contact?.timezone,
    countryIso: contact?.countryIso ?? contact?.phoneCountryIso,
  });
  return `${f.dateTime} · ${f.place}`;
};

export const ensureTherapyPackage = async (
  enrollmentId: string,
  totalSessions: number
) => {
  const existing = await prisma.therapyPackage.findUnique({
    where: { enrollmentId },
    include: { sessions: { select: { sessionNumber: true } } },
  });
  if (existing) {
    const existingNumbers = new Set(existing.sessions.map((s) => s.sessionNumber));
    const missing = Array.from({ length: totalSessions }, (_, i) => i + 1).filter(
      (n) => !existingNumbers.has(n)
    );
    if (missing.length > 0) {
      await prisma.therapySession.createMany({
        data: missing.map((sessionNumber) => ({
          therapyPackageId: existing.id,
          sessionNumber,
          status: TherapySessionStatus.PENDING_SCHEDULE,
          durationMinutes: 60,
        })),
        skipDuplicates: true,
      });
    }
    return prisma.therapyPackage.findUnique({ where: { id: existing.id } });
  }

  const pkg = await prisma.therapyPackage.create({
    data: {
      enrollmentId,
      totalSessions,
      usedSessions: 0,
    },
  });

  await prisma.therapySession.createMany({
    data: Array.from({ length: totalSessions }, (_, i) => ({
      therapyPackageId: pkg.id,
      sessionNumber: i + 1,
      status: TherapySessionStatus.PENDING_SCHEDULE,
      durationMinutes: 60,
    })),
    skipDuplicates: true,
  });

  return pkg;
};

export const completeTherapySession = async (sessionId: string) => {
  const session = await prisma.therapySession.findUnique({
    where: { id: sessionId },
    include: {
      therapyPackage: {
        include: {
          enrollment: {
            select: {
              id: true,
              contactId: true,
              contact: { select: { displayName: true, firstName: true } },
            },
          },
        },
      },
    },
  });
  if (!session) throw new Error("SESSION_NOT_FOUND");

  const pkg = session.therapyPackage;
  if (pkg.usedSessions >= pkg.totalSessions) {
    throw new Error("NO_SESSIONS_LEFT");
  }

  await prisma.$transaction([
    prisma.therapySession.update({
      where: { id: sessionId },
      data: {
        status: TherapySessionStatus.COMPLETED,
        completedAt: new Date(),
      },
    }),
    prisma.therapyPackage.update({
      where: { id: pkg.id },
      data: { usedSessions: { increment: 1 } },
    }),
    prisma.enrollment.update({
      where: { id: pkg.enrollmentId },
      data: { sessionsUsed: { increment: 1 } },
    }),
  ]);

  const updatedPkg = await prisma.therapyPackage.findUnique({
    where: { id: pkg.id },
  });

  if (updatedPkg && updatedPkg.usedSessions >= updatedPkg.totalSessions) {
    await prisma.enrollment.update({
      where: { id: pkg.enrollmentId },
      data: {
        status: EnrollmentStatus.COMPLETED,
        completedAt: new Date(),
      },
    });
  }

  const who = contactName(pkg.enrollment.contact);
  fireNotification({
    eventType: "THERAPY_SESSION_COMPLETED",
    title: `Sesión ${session.sessionNumber} completada: ${who}`,
    body: `Van ${updatedPkg?.usedSessions ?? pkg.usedSessions + 1} de ${pkg.totalSessions} sesiones.`,
    href: `/admin/enrollments/${pkg.enrollmentId}`,
    entityType: "TherapySession",
    entityId: sessionId,
    staff: "ALL",
  });

  return prisma.therapySession.findUnique({
    where: { id: sessionId },
    include: { therapyPackage: true },
  });
};

export const uncompleteTherapySession = async (sessionId: string) => {
  const session = await prisma.therapySession.findUnique({
    where: { id: sessionId },
    include: {
      therapyPackage: {
        include: { enrollment: { include: { product: true } } },
      },
    },
  });
  if (!session) throw new Error("SESSION_NOT_FOUND");
  if (session.status !== TherapySessionStatus.COMPLETED) {
    throw new Error("SESSION_NOT_COMPLETED");
  }

  const pkg = session.therapyPackage;
  if (pkg.usedSessions <= 0) {
    throw new Error("NO_USED_SESSIONS");
  }

  const enrollment = pkg.enrollment;
  const revertingEnrollmentFromCompleted =
    enrollment.status === EnrollmentStatus.COMPLETED;

  if (
    revertingEnrollmentFromCompleted &&
    enrollment.product.kind === ProductKind.THERAPY
  ) {
    const otherActive = await prisma.enrollment.findFirst({
      where: {
        contactId: enrollment.contactId,
        status: EnrollmentStatus.ACTIVE,
        product: { kind: "THERAPY" },
        id: { not: enrollment.id },
      },
    });
    if (otherActive) {
      throw new Error("ACTIVE_THERAPY_EXISTS");
    }
  }

  const restoreStatus = session.scheduledAt
    ? TherapySessionStatus.SCHEDULED
    : TherapySessionStatus.PENDING_SCHEDULE;

  await prisma.$transaction([
    prisma.therapySession.update({
      where: { id: sessionId },
      data: {
        status: restoreStatus,
        completedAt: null,
      },
    }),
    prisma.therapyPackage.update({
      where: { id: pkg.id },
      data: { usedSessions: { decrement: 1 } },
    }),
    prisma.enrollment.update({
      where: { id: pkg.enrollmentId },
      data: {
        sessionsUsed: { decrement: 1 },
        ...(revertingEnrollmentFromCompleted
          ? { status: EnrollmentStatus.ACTIVE, completedAt: null }
          : {}),
      },
    }),
  ]);

  return prisma.therapySession.findUnique({
    where: { id: sessionId },
    include: { therapyPackage: true },
  });
};

export const scheduleTherapySession = async (input: {
  therapyPackageId: string;
  sessionNumber: number;
  scheduledAt: Date;
  meetUrl?: string;
  durationMinutes?: number;
}) => {
  const existing = await prisma.therapySession.findUnique({
    where: {
      therapyPackageId_sessionNumber: {
        therapyPackageId: input.therapyPackageId,
        sessionNumber: input.sessionNumber,
      },
    },
    include: {
      therapyPackage: {
        include: {
          enrollment: {
            select: {
              contactId: true,
              contact: {
                select: {
                  displayName: true,
                  firstName: true,
                  timezone: true,
                  countryIso: true,
                  phoneCountryIso: true,
                },
              },
            },
          },
        },
      },
    },
  });

  if (!existing) {
    throw new Error("SLOT_NOT_FOUND");
  }

  const pkg = existing.therapyPackage;
  if (input.sessionNumber > pkg.totalSessions) {
    throw new Error("INVALID_SESSION_NUMBER");
  }

  if (existing.status === TherapySessionStatus.COMPLETED) {
    throw new Error("SESSION_ALREADY_COMPLETED");
  }

  const schedulable: TherapySessionStatus[] = [
    TherapySessionStatus.PENDING_SCHEDULE,
    TherapySessionStatus.SCHEDULED,
    TherapySessionStatus.RESCHEDULED,
    TherapySessionStatus.CANCELLED,
  ];

  if (!schedulable.includes(existing.status)) {
    throw new Error("SESSION_NOT_SCHEDULABLE");
  }

  const updated = await prisma.therapySession.update({
    where: { id: existing.id },
    data: {
      scheduledAt: input.scheduledAt,
      meetUrl: input.meetUrl ?? pkg.meetDefaultUrl,
      durationMinutes: input.durationMinutes ?? existing.durationMinutes,
      status: TherapySessionStatus.SCHEDULED,
    },
  });

  fireNotification({
    eventType: "THERAPY_SESSION_SCHEDULED",
    title: `Sesión ${input.sessionNumber} agendada: ${contactName(
      pkg.enrollment.contact
    )}`,
    body: `${formatSessionMoment(input.scheduledAt, pkg.enrollment.contact)}.`,
    entityType: "TherapySession",
    entityId: updated.id,
    metadata: { enrollmentId: pkg.enrollmentId },
    staff: "ALL",
    contactIds: [pkg.enrollment.contactId],
  });

  return updated;
};

export const getTherapyPackageByEnrollment = async (enrollmentId: string) =>
  prisma.therapyPackage.findUnique({
    where: { enrollmentId },
    include: {
      sessions: { orderBy: { sessionNumber: "asc" } },
      enrollment: { include: { contact: true, product: true } },
    },
  });

export const updateTherapyPackage = async (
  therapyPackageId: string,
  data: { meetDefaultUrl?: string | null; reprogrammingNotes?: string | null }
) =>
  prisma.therapyPackage.update({
    where: { id: therapyPackageId },
    data: {
      meetDefaultUrl: data.meetDefaultUrl,
      reprogrammingNotes: data.reprogrammingNotes,
    },
  });

export const updateTherapySession = async (
  sessionId: string,
  data: {
    scheduledAt?: Date;
    meetUrl?: string | null;
    status?: TherapySessionStatus;
    durationMinutes?: number;
  }
) =>
  prisma.therapySession.update({
    where: { id: sessionId },
    data: {
      scheduledAt: data.scheduledAt,
      meetUrl: data.meetUrl,
      status: data.status,
      durationMinutes: data.durationMinutes,
    },
  });

export const markTherapySessionNoShow = async (sessionId: string) => {
  const session = await prisma.therapySession.update({
    where: { id: sessionId },
    data: { status: TherapySessionStatus.NO_SHOW },
  });

  // Read separately instead of widening the update's `include`: callers
  // serialize this return value straight to the client.
  const pkg = await prisma.therapyPackage.findUnique({
    where: { id: session.therapyPackageId },
    select: {
      enrollmentId: true,
      enrollment: {
        select: {
          contact: {
            select: {
              displayName: true,
              firstName: true,
              timezone: true,
              countryIso: true,
              phoneCountryIso: true,
            },
          },
        },
      },
    },
  });

  fireNotification({
    eventType: "THERAPY_SESSION_NO_SHOW",
    title: `Inasistencia en la sesión ${session.sessionNumber}${
      pkg ? `: ${contactName(pkg.enrollment.contact)}` : ""
    }`,
    body: session.scheduledAt
      ? `Estaba agendada para ${formatSessionMoment(
          session.scheduledAt,
          pkg?.enrollment.contact
        )}.`
      : null,
    href: pkg ? `/admin/enrollments/${pkg.enrollmentId}` : null,
    entityType: "TherapySession",
    entityId: sessionId,
    staff: "ALL",
  });

  return session;
};
