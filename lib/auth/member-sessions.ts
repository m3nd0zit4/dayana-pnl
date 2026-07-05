import crypto from "crypto";
import { prisma } from "@/lib/db";
import { deviceLabelFromUserAgent } from "@/lib/auth/device-label";

const SESSION_MAX_AGE_SEC = 60 * 60 * 24 * 30;

const hashToken = (token: string) =>
  crypto.createHash("sha256").update(token).digest("hex");

export const createMemberSession = async (input: {
  memberAccountId: string;
  userAgent?: string | null;
  ipAddress?: string | null;
}) => {
  const sessionToken = crypto.randomBytes(32).toString("hex");
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_MAX_AGE_SEC * 1000);

  return prisma.memberSession.create({
    data: {
      memberAccountId: input.memberAccountId,
      sessionToken: hashToken(sessionToken),
      userAgent: input.userAgent?.slice(0, 512) ?? null,
      ipAddress: input.ipAddress?.slice(0, 64) ?? null,
      deviceLabel: deviceLabelFromUserAgent(input.userAgent ?? null),
      lastSeenAt: now,
      expiresAt,
    },
  });
};

export const validateMemberSession = async (sessionId: string) => {
  const row = await prisma.memberSession.findUnique({
    where: { id: sessionId },
  });
  if (!row) return null;
  if (row.revokedAt) return null;
  if (row.expiresAt < new Date()) return null;
  return row;
};

export const touchMemberSession = async (
  sessionId: string,
  meta?: { userAgent?: string | null; ipAddress?: string | null }
) => {
  const data: {
    lastSeenAt: Date;
    userAgent?: string;
    ipAddress?: string;
    deviceLabel?: string;
  } = { lastSeenAt: new Date() };

  if (meta?.userAgent) {
    data.userAgent = meta.userAgent.slice(0, 512);
    data.deviceLabel = deviceLabelFromUserAgent(meta.userAgent);
  }
  if (meta?.ipAddress) {
    data.ipAddress = meta.ipAddress.slice(0, 64);
  }

  await prisma.memberSession.update({
    where: { id: sessionId },
    data,
  });
};

export const revokeMemberSession = async (sessionId: string) => {
  await prisma.memberSession.update({
    where: { id: sessionId },
    data: { revokedAt: new Date() },
  });
};

export const revokeAllMemberSessionsExcept = async (
  memberAccountId: string,
  exceptSessionId?: string
) => {
  await prisma.memberSession.updateMany({
    where: {
      memberAccountId,
      revokedAt: null,
      ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}),
    },
    data: { revokedAt: new Date() },
  });
};

export const revokeAllMemberSessions = async (memberAccountId: string) => {
  await revokeAllMemberSessionsExcept(memberAccountId);
};
