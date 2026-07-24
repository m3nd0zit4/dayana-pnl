import type { Prisma } from "@prisma/client";
import { prisma } from "../db";

export const writeAuditLog = async (input: {
  staffUserId?: string;
  action: string;
  entityType: string;
  entityId: string;
  changes?: unknown;
}) =>
  prisma.auditLog.create({
    data: {
      staffUserId: input.staffUserId ?? null,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      changes: input.changes
        ? (input.changes as Prisma.InputJsonValue)
        : undefined,
    },
  });

/** Non-blocking audit write — does not delay API responses. */
export const fireAuditLog = (input: Parameters<typeof writeAuditLog>[0]) => {
  void writeAuditLog(input).catch(() => undefined);
};

export const listAuditLogs = async (
  filters: { limit?: number; entityType?: string; action?: string } = {}
) =>
  prisma.auditLog.findMany({
    where: {
      ...(filters.entityType ? { entityType: filters.entityType } : {}),
      ...(filters.action ? { action: filters.action } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: Math.min(100, filters.limit ?? 50),
    include: {
      staffUser: { select: { displayName: true, email: true } },
    },
  });
