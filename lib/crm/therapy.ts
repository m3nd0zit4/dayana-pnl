import { EnrollmentStatus, TherapySessionStatus } from "@prisma/client";
import { prisma } from "../db";

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
        include: { enrollment: { select: { id: true, contactId: true } } },
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
    include: { therapyPackage: true },
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

  return prisma.therapySession.update({
    where: { id: existing.id },
    data: {
      scheduledAt: input.scheduledAt,
      meetUrl: input.meetUrl ?? pkg.meetDefaultUrl,
      durationMinutes: input.durationMinutes ?? existing.durationMinutes,
      status: TherapySessionStatus.SCHEDULED,
    },
  });
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

export const markTherapySessionNoShow = async (sessionId: string) =>
  prisma.therapySession.update({
    where: { id: sessionId },
    data: { status: TherapySessionStatus.NO_SHOW },
  });
