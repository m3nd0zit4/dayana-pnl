/**
 * One-off: migrate TherapySession.clinicalNotes → ContactNote (TEXT).
 * Run after migration deploy: bunx tsx prisma/scripts/migrate-clinical-notes.ts
 */
import { ContactNoteKind, PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const sessions = await prisma.therapySession.findMany({
    where: {
      clinicalNotes: { not: null },
      NOT: { clinicalNotes: "" },
    },
    include: {
      therapyPackage: { select: { enrollmentId: true, enrollment: { select: { contactId: true } } } },
    },
  });

  let created = 0;
  let skipped = 0;

  for (const session of sessions) {
    const body = session.clinicalNotes?.trim();
    if (!body) continue;

    const existing = await prisma.contactNote.findFirst({
      where: { therapySessionId: session.id, kind: ContactNoteKind.TEXT },
    });
    if (existing) {
      skipped++;
      continue;
    }

    await prisma.contactNote.create({
      data: {
        contactId: session.therapyPackage.enrollment.contactId,
        kind: ContactNoteKind.TEXT,
        bodyText: body,
        therapySessionId: session.id,
        enrollmentId: session.therapyPackage.enrollmentId,
      },
    });
    created++;
  }

  console.log(`ContactNote migration: ${created} created, ${skipped} skipped`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
