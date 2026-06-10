import crypto from "crypto";
import { headers } from "next/headers";
import { prisma } from "@/lib/db";
import { deviceLabelFromUserAgent } from "@/lib/auth/device-label";

const SESSION_MAX_AGE_SEC = 60 * 60 * 24 * 30;

const hashToken = (token: string) =>
  crypto.createHash("sha256").update(token).digest("hex");

export const createStaffSession = async (input: {
  staffUserId: string;
  userAgent?: string | null;
  ipAddress?: string | null;
}) => {
  const sessionToken = crypto.randomBytes(32).toString("hex");
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_MAX_AGE_SEC * 1000);

  return prisma.staffSession.create({
    data: {
      staffUserId: input.staffUserId,
      sessionToken: hashToken(sessionToken),
      userAgent: input.userAgent?.slice(0, 512) ?? null,
      ipAddress: input.ipAddress?.slice(0, 64) ?? null,
      deviceLabel: deviceLabelFromUserAgent(input.userAgent ?? null),
      lastSeenAt: now,
      expiresAt,
    },
  });
};

export const validateStaffSession = async (sessionId: string) => {
  const row = await prisma.staffSession.findUnique({
    where: { id: sessionId },
  });
  if (!row) return null;
  if (row.revokedAt) return null;
  if (row.expiresAt < new Date()) return null;
  return row;
};

export const touchStaffSession = async (
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

  await prisma.staffSession.update({
    where: { id: sessionId },
    data,
  });
};

export const revokeStaffSession = async (sessionId: string) => {
  await prisma.staffSession.update({
    where: { id: sessionId },
    data: { revokedAt: new Date() },
  });
};

export const revokeAllStaffSessionsExcept = async (
  staffUserId: string,
  exceptSessionId?: string
) => {
  await prisma.staffSession.updateMany({
    where: {
      staffUserId,
      revokedAt: null,
      ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}),
    },
    data: { revokedAt: new Date() },
  });
};

export const revokeAllStaffSessions = async (staffUserId: string) => {
  await revokeAllStaffSessionsExcept(staffUserId);
};

export const listStaffSessions = async (staffUserId: string) =>
  prisma.staffSession.findMany({
    where: {
      staffUserId,
      revokedAt: null,
      expiresAt: { gt: new Date() },
    },
    orderBy: { lastSeenAt: "desc" },
    select: {
      id: true,
      deviceLabel: true,
      userAgent: true,
      ipAddress: true,
      lastSeenAt: true,
      createdAt: true,
      expiresAt: true,
    },
  });

export const readRequestMeta = async () => {
  const h = await headers();
  return {
    userAgent: h.get("user-agent"),
    ipAddress:
      h.get("x-forwarded-for")?.split(",")[0]?.trim() ??
      h.get("x-real-ip") ??
      null,
  };
};
