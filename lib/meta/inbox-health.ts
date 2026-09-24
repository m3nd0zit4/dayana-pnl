import { prisma } from "@/lib/db";

/**
 * Salud de la cola de entrada, para la página Estado. Aparte de `inbox.ts` a
 * propósito: no arrastra el procesamiento (ni la IA) a quien solo quiere mirar.
 */
export type InboxHealth = {
  pending: number;
  failed: number;
  dead: number;
  oldestPendingAt: string | null;
  lastProcessedAt: string | null;
  deadSamples: { id: string; kind: string; lastError: string | null; receivedAt: string }[];
};

export const getInboxHealth = async (): Promise<InboxHealth> => {
  const [grouped, oldest, last, dead] = await Promise.all([
    prisma.metaInboxEvent.groupBy({ by: ["state"], _count: { _all: true } }),
    prisma.metaInboxEvent.findFirst({
      where: { state: { in: ["RECEIVED", "PROCESSING", "FAILED"] } },
      orderBy: { receivedAt: "asc" },
      select: { receivedAt: true },
    }),
    prisma.metaInboxEvent.findFirst({
      where: { state: "DONE" },
      orderBy: { processedAt: "desc" },
      select: { processedAt: true },
    }),
    prisma.metaInboxEvent.findMany({
      where: { state: "DEAD" },
      orderBy: { receivedAt: "desc" },
      take: 5,
      select: { id: true, kind: true, lastError: true, receivedAt: true },
    }),
  ]);
  const count = (s: string) => grouped.find((g) => g.state === s)?._count._all ?? 0;
  return {
    pending: count("RECEIVED") + count("PROCESSING"),
    failed: count("FAILED"),
    dead: count("DEAD"),
    oldestPendingAt: oldest?.receivedAt.toISOString() ?? null,
    lastProcessedAt: last?.processedAt?.toISOString() ?? null,
    deadSamples: dead.map((d) => ({ ...d, receivedAt: d.receivedAt.toISOString() })),
  };
};
