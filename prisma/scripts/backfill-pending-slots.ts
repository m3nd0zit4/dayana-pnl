/**
 * One-off: create PENDING_SCHEDULE slots for active therapy packages missing sessions.
 * Run: bunx tsx prisma/scripts/backfill-pending-slots.ts
 */
import { TherapySessionStatus, PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const packages = await prisma.therapyPackage.findMany({
    include: { sessions: { select: { sessionNumber: true } } },
  });

  let created = 0;

  for (const pkg of packages) {
    const existingNumbers = new Set(pkg.sessions.map((s) => s.sessionNumber));
    const missing: { therapyPackageId: string; sessionNumber: number; status: TherapySessionStatus; durationMinutes: number }[] = [];

    for (let n = 1; n <= pkg.totalSessions; n++) {
      if (!existingNumbers.has(n)) {
        missing.push({
          therapyPackageId: pkg.id,
          sessionNumber: n,
          status: TherapySessionStatus.PENDING_SCHEDULE,
          durationMinutes: 60,
        });
      }
    }

    if (missing.length > 0) {
      await prisma.therapySession.createMany({ data: missing, skipDuplicates: true });
      created += missing.length;
    }
  }

  console.log(`Backfill: ${created} PENDING_SCHEDULE slots created`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
