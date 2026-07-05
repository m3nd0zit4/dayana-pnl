/**
 * One-off: inicializa la membresía mensual del curso para inscripciones que
 * existían antes del portal de miembros.
 *
 * - Marca TODOS los pagos APPROVED históricos de inscripciones COURSE con
 *   membershipAppliedAt (para que el safety-net de Inngest no los cuente).
 * - Fija Enrollment.paidUntil = último pago APPROVED + 1 mes (solo si
 *   paidUntil está vacío — no pisa ajustes manuales).
 *
 * Uso: bun run scripts/backfill-course-paid-until.ts [--dry-run]
 */
import { readFileSync, existsSync } from "fs";
import { resolve } from "path";

const loadEnv = () => {
  const path = resolve(process.cwd(), ".env");
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i < 1) continue;
    const key = t.slice(0, i).trim();
    let val = t.slice(i + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
};
loadEnv();

import { addMonths } from "date-fns";
import { EnrollmentStatus, PaymentStatus, ProductKind } from "@prisma/client";
import { prisma } from "../lib/db";

const dryRun = process.argv.includes("--dry-run");

const main = async () => {
  const enrollments = await prisma.enrollment.findMany({
    where: {
      product: { kind: ProductKind.COURSE },
      status: {
        in: [EnrollmentStatus.ACTIVE, EnrollmentStatus.COMPLETED],
      },
    },
    include: {
      contact: { select: { email: true, firstName: true } },
      payments: {
        where: { status: PaymentStatus.APPROVED },
        orderBy: { paidAt: "desc" },
      },
    },
  });

  console.log(`Inscripciones de curso encontradas: ${enrollments.length}`);

  for (const enrollment of enrollments) {
    const unapplied = enrollment.payments.filter(
      (p) => p.membershipAppliedAt == null
    );
    const latest = enrollment.payments[0];
    const latestPaidAt = latest?.paidAt ?? latest?.createdAt ?? null;
    const paidUntil =
      enrollment.paidUntil ?? (latestPaidAt ? addMonths(latestPaidAt, 1) : null);

    console.log(
      [
        `- ${enrollment.id}`,
        enrollment.contact.email ?? "(sin email)",
        `pagos=${enrollment.payments.length} sin marcar=${unapplied.length}`,
        `paidUntil=${enrollment.paidUntil?.toISOString() ?? "∅"} → ${paidUntil?.toISOString() ?? "∅"}`,
      ].join("  ")
    );

    if (dryRun) continue;

    if (unapplied.length > 0) {
      await prisma.payment.updateMany({
        where: { id: { in: unapplied.map((p) => p.id) } },
        data: { membershipAppliedAt: new Date() },
      });
    }

    if (!enrollment.paidUntil && paidUntil) {
      await prisma.enrollment.update({
        where: { id: enrollment.id },
        data: { paidUntil },
      });
    }
  }

  console.log(dryRun ? "Dry run — sin cambios." : "Backfill completado.");
};

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
