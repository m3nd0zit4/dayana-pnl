/**
 * Optional one-off if migrations were applied before data migration split.
 * Run: bunx tsx prisma/scripts/migrate-pending-schedule-status.ts
 */
import { TherapySessionStatus, PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const result = await prisma.therapySession.updateMany({
    where: {
      scheduledAt: null,
      status: TherapySessionStatus.SCHEDULED,
      completedAt: null,
    },
    data: { status: TherapySessionStatus.PENDING_SCHEDULE },
  });
  console.log(`Updated ${result.count} sessions to PENDING_SCHEDULE`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
