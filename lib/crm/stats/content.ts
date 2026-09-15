import "server-only";

import { EnrollmentStatus } from "@prisma/client";

import { prisma } from "@/lib/db";

import { toBreakdownRows } from "./breakdown";
import type { ContentStats } from "./dto";
import { withDelta, ratio } from "./kpi";
import { bucketKeys } from "./range";
import { fillSeries, sumByBucket } from "./series";
import { toNumber } from "./currency";
import type { StatsRange } from "./types";
import { formatWebinarEditionLabel, shapeWorkshopEditions } from "./people-content-helpers";
import { ATTRIBUTION_DAYS } from "./sales-helpers";

/**
 * «Webinar, talleres y cursos» de Estadísticas.
 *
 * `LiveClassSession` es el modelo real detrás de lo que el plan llama
 * "CourseClass": una clase del curso (grabada o en vivo), agrupada
 * opcionalmente bajo un `CourseModule`.
 */

/** Fila diaria (fecha local "YYYY-MM-DD") de un `COUNT(*)` agrupado. */
type DayCountRow = { day: string; count: bigint | number | string };

export async function getContentStats(range: StatsRange): Promise<ContentStats> {
  const [
    registrationsCount,
    registrationsPrevCount,
    registrationsSeriesRows,
    byEditionRows,
    reminderFailuresCount,
    registrantsWhoPurchasedRows,
    workshopEditions,
    classCompletionsCount,
    classCompletionsPrevCount,
    completionsSeriesRows,
    moduleCompletionRows,
    quizAttemptsCount,
    quizPassedCount,
    commentsCount,
    commentsPrevCount,
  ] = await Promise.all([
    prisma.webinarRegistration.count({
      where: { createdAt: { gte: range.from, lt: range.to } },
    }),
    prisma.webinarRegistration.count({
      where: { createdAt: { gte: range.prevFrom, lt: range.prevTo } },
    }),
    prisma.$queryRaw<DayCountRow[]>`
      SELECT
        to_char((("created_at" AT TIME ZONE 'UTC') AT TIME ZONE ${range.timeZone})::date, 'YYYY-MM-DD') AS day,
        COUNT(*)::bigint AS count
      FROM "webinar_registrations"
      WHERE "created_at" >= ${range.from} AND "created_at" < ${range.to}
      GROUP BY 1
    `,
    prisma.webinarRegistration.groupBy({
      by: ["webinarId"],
      where: { createdAt: { gte: range.from, lt: range.to } },
      _count: { _all: true },
    }),
    prisma.webinarRegistration.count({
      where: { lastSendErrorAt: { gte: range.from, lt: range.to } },
    }),
    // Registradas del rango cuyo contacto tiene un pago APROBADO en los
    // ATTRIBUTION_DAYS días siguientes a su registro — la misma ventana que el
    // embudo del diagnóstico, para que «compró después» signifique lo mismo en
    // las dos áreas. Sin acotar a un producto concreto.
    prisma.$queryRaw<{ count: bigint }[]>`
      SELECT COUNT(DISTINCT wr."id")::bigint AS count
      FROM "webinar_registrations" wr
      WHERE wr."created_at" >= ${range.from} AND wr."created_at" < ${range.to}
        AND EXISTS (
          SELECT 1
          FROM "payments" p
          JOIN "enrollments" e ON e."id" = p."enrollment_id"
          WHERE e."contact_id" = wr."contact_id"
            AND p."status" = 'APPROVED'
            AND p."paid_at" >= wr."created_at"
            AND p."paid_at" < wr."created_at" + ${ATTRIBUTION_DAYS}::int * interval '1 day'
        )
    `,
    // Ediciones vigentes o recientes de taller: pasadas hasta 30 días atrás
    // (para poder mirar el cupo vendido de la que acaba de cerrar) y futuras
    // hasta 90 días (para ver qué viene). Fuera de esa ventana no aporta a
    // una foto de "estos días".
    prisma.workshopEdition.findMany({
      where: {
        startsAt: {
          not: null,
          gte: new Date(range.from.getTime() - 30 * 24 * 60 * 60 * 1000),
          lt: new Date(range.to.getTime() + 90 * 24 * 60 * 60 * 1000),
        },
      },
      select: { id: true, title: true, startsAt: true, capacity: true },
    }),
    prisma.courseClassProgress.count({
      where: { completedAt: { gte: range.from, lt: range.to } },
    }),
    prisma.courseClassProgress.count({
      where: { completedAt: { gte: range.prevFrom, lt: range.prevTo } },
    }),
    prisma.$queryRaw<DayCountRow[]>`
      SELECT
        to_char((("completed_at" AT TIME ZONE 'UTC') AT TIME ZONE ${range.timeZone})::date, 'YYYY-MM-DD') AS day,
        COUNT(*)::bigint AS count
      FROM "course_class_progress"
      WHERE "completed_at" >= ${range.from} AND "completed_at" < ${range.to}
      GROUP BY 1
    `,
    prisma.$queryRaw<{ module_id: string; title: string; count: bigint }[]>`
      SELECT
        COALESCE(m."id", '__sin-modulo__') AS module_id,
        COALESCE(m."title", 'Sin módulo') AS title,
        COUNT(*)::bigint AS count
      FROM "course_class_progress" cp
      JOIN "live_class_sessions" c ON c."id" = cp."class_id"
      LEFT JOIN "course_modules" m ON m."id" = c."module_id"
      WHERE cp."completed_at" >= ${range.from} AND cp."completed_at" < ${range.to}
      GROUP BY 1, 2
    `,
    prisma.quizAttempt.count({
      where: { submittedAt: { gte: range.from, lt: range.to } },
    }),
    prisma.quizAttempt.count({
      where: { submittedAt: { gte: range.from, lt: range.to }, passed: true },
    }),
    prisma.lessonComment.count({
      where: { createdAt: { gte: range.from, lt: range.to }, hiddenAt: null },
    }),
    prisma.lessonComment.count({
      where: { createdAt: { gte: range.prevFrom, lt: range.prevTo }, hiddenAt: null },
    }),
  ]);

  const registrations = withDelta(registrationsCount, registrationsPrevCount);
  const registrationsSeries = fillSeries(
    bucketKeys(range),
    sumByBucket(
      registrationsSeriesRows.map((r) => ({ dateKey: r.day, value: toNumber(r.count) })),
      range.granularity,
    ),
  );

  // El label de cada edición sólo necesita fecha + id: se resuelve con las
  // propias filas del `groupBy` (que ya trae `webinarId`) contra un mapa de
  // `FreeWebinar` cargado sólo para esos ids.
  const editionIds = byEditionRows.map((r) => r.webinarId);
  const editions =
    editionIds.length > 0
      ? await prisma.freeWebinar.findMany({
          where: { id: { in: editionIds } },
          select: { id: true, startsAt: true },
        })
      : [];
  const editionById = new Map(editions.map((e) => [e.id, e]));
  const byEdition = toBreakdownRows(
    byEditionRows.map((r) => ({
      key: r.webinarId,
      value: r._count._all,
      label: formatWebinarEditionLabel(
        { startsAt: editionById.get(r.webinarId)?.startsAt ?? null },
        range.timeZone,
      ),
    })),
  );

  const reminderFailures = reminderFailuresCount;
  const registrantsWhoPurchased = toNumber(registrantsWhoPurchasedRows[0]?.count ?? 0);

  const editionIdsForSeats = workshopEditions.map((e) => e.id);
  const seatsSoldRows =
    editionIdsForSeats.length > 0
      ? await prisma.enrollment.groupBy({
          by: ["workshopEditionId"],
          where: {
            workshopEditionId: { in: editionIdsForSeats },
            status: { in: [EnrollmentStatus.ACTIVE, EnrollmentStatus.COMPLETED] },
          },
          _count: { _all: true },
        })
      : [];
  const seatsSoldById = new Map(
    seatsSoldRows
      .filter((r): r is typeof r & { workshopEditionId: string } => r.workshopEditionId != null)
      .map((r) => [r.workshopEditionId, r._count._all]),
  );

  const editionsDto = shapeWorkshopEditions(
    workshopEditions.map((e) => ({
      id: e.id,
      title: e.title,
      startsAt: e.startsAt as Date,
      capacity: e.capacity,
    })),
    seatsSoldById,
  );

  const classCompletions = withDelta(classCompletionsCount, classCompletionsPrevCount);
  const completionsSeries = fillSeries(
    bucketKeys(range),
    sumByBucket(
      completionsSeriesRows.map((r) => ({ dateKey: r.day, value: toNumber(r.count) })),
      range.granularity,
    ),
  );
  const moduleCompletion = toBreakdownRows(
    moduleCompletionRows.map((r) => ({
      key: r.module_id,
      value: toNumber(r.count),
      label: r.title,
    })),
  );

  const quizPassRate = ratio(quizPassedCount, quizAttemptsCount);
  const comments = withDelta(commentsCount, commentsPrevCount);

  return {
    webinar: {
      registrations,
      registrationsSeries,
      byEdition,
      reminderFailures,
      registrantsWhoPurchased,
    },
    workshops: {
      editions: editionsDto,
    },
    courses: {
      classCompletions,
      completionsSeries,
      moduleCompletion,
      quizPassRate,
      quizAttempts: quizAttemptsCount,
      comments,
    },
  };
}
