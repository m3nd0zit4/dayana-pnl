import type { LiveClassSession } from "@prisma/client";
import { prisma } from "@/lib/db";

/** Recordings disappear from the portal this many days after being posted. */
export const RECORDING_RETENTION_DAYS = 30;

const retentionMs = RECORDING_RETENTION_DAYS * 24 * 60 * 60 * 1000;

export const recordingVisibleUntil = (
  recordingPostedAt: Date
): Date => new Date(recordingPostedAt.getTime() + retentionMs);

/**
 * Compute-side gate in addition to the nightly auto-hide cron, so a recording
 * never outlives its window even if the cron lags.
 */
export const isRecordingVisible = (
  cls: Pick<
    LiveClassSession,
    "recordingUrl" | "recordingPostedAt" | "recordingHiddenAt"
  >,
  now: Date = new Date()
): boolean => {
  if (!cls.recordingUrl || cls.recordingHiddenAt) return false;
  if (!cls.recordingPostedAt) return false;
  return recordingVisibleUntil(cls.recordingPostedAt) > now;
};

export const recordingDaysLeft = (
  recordingPostedAt: Date,
  now: Date = new Date()
): number =>
  Math.max(
    0,
    Math.ceil(
      (recordingVisibleUntil(recordingPostedAt).getTime() - now.getTime()) /
        (24 * 60 * 60 * 1000)
    )
  );

export const getPublishedModules = async (productId: string) =>
  prisma.courseModule.findMany({
    where: { productId, isPublished: true },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  });

export const getPublishedModule = async (productId: string, id: string) =>
  prisma.courseModule.findFirst({
    where: { id, productId, isPublished: true },
  });

/**
 * Modules with their ordered classes nested — the single query the course
 * player's sidebar and the dashboard's progress calc both build from.
 * Unassigned classes (moduleId null) are deliberately excluded: they aren't
 * visible anywhere in the student portal until staff assigns them to a week.
 */
export const getCourseOutline = async (productId: string) =>
  prisma.courseModule.findMany({
    where: { productId, isPublished: true },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    include: {
      classes: {
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      },
    },
  });

export const getPublishedClass = async (productId: string, id: string) =>
  prisma.liveClassSession.findFirst({
    where: { id, productId, module: { isPublished: true } },
    include: { module: true },
  });

export const getClassesForCourse = async (productId: string) => {
  const classes = await prisma.liveClassSession.findMany({
    where: { productId },
    orderBy: [{ scheduledAt: { sort: "desc", nulls: "last" } }],
  });

  const now = new Date();
  // A class with a recording is watchable material even if its scheduledAt
  // is (still) in the future — treat it as past/recorded.
  const upcoming = classes
    .filter((c) => c.scheduledAt && c.scheduledAt > now && !c.recordingUrl)
    .sort(
      (a, b) => (a.scheduledAt?.getTime() ?? 0) - (b.scheduledAt?.getTime() ?? 0)
    );
  const past = classes.filter(
    (c) => !c.scheduledAt || c.scheduledAt <= now || c.recordingUrl
  );

  return { upcoming, past, now };
};
