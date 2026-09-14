import "server-only";

import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";
import { diagnosticSourceLabel } from "@/lib/crm/diagnostic-answers";
import { PROFILE_SHORT_LABEL } from "@/lib/diagnostico/profiles";

import { toBreakdownRows, toFunnelSteps } from "./breakdown";
import { toNumber } from "./currency";
import type { FunnelStats } from "./dto";
import { withDelta } from "./kpi";
import {
  ATTRIBUTION_DAYS,
  FUNNEL_STEP_LABELS,
  NO_PROFILE_LABEL,
  NO_SOURCE_LABEL,
  NULL_KEY,
  aggregateAnswerDistribution,
} from "./sales-helpers";
import type { StatsRange } from "./types";

/**
 * «Embudo del diagnóstico». Periodo actual = [from, to); anterior = [prevFrom, prevTo).
 */

/**
 * «Compró tras el diagnóstico» (SQL sobre el alias `d` de "diagnostics"): la
 * persona tiene contacto y ALGUNA matrícula suya tiene un pago APPROVED con
 * `paid_at` en [completed_at, completed_at + ATTRIBUTION_DAYS días). Sin
 * contacto no hay a quién atribuir la compra: cuenta como no comprado. Se mira
 * cualquier producto, no solo el recomendado: lo que interesa es si el
 * diagnóstico acabó en venta.
 */
const PURCHASED_SQL = Prisma.sql`(
  d."contact_id" IS NOT NULL
  AND d."completed_at" IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM "payments" p
    JOIN "enrollments" e ON e."id" = p."enrollment_id"
    WHERE e."contact_id" = d."contact_id"
      AND p."status" = 'APPROVED'
      AND p."paid_at" >= d."completed_at"
      AND p."paid_at" < d."completed_at" + ${ATTRIBUTION_DAYS}::int * interval '1 day'
  )
)`;

type StepsRow = {
  started: bigint;
  completed: bigint;
  viewed: bigint;
  clicked: bigint;
};

type CompletedRow = {
  completed_current: bigint;
  completed_previous: bigint;
  purchased_current: bigint;
  purchased_previous: bigint;
};

export async function getFunnelStats(range: StatsRange): Promise<FunnelStats> {
  const { from, to, prevFrom, prevTo } = range;
  const completedInRange = { completedAt: { gte: from, lt: to } };

  const [stepsRows, completedRows, sourceGroups, profileGroups, answerRows] = await Promise.all([
    // Embudo de UNA cohorte: diagnósticos EMPEZADOS (`created_at`) en el
    // periodo. Cada paso exige también los anteriores, así los pasos están
    // anidados y nunca suben aunque haya sellos incoherentes (p. ej. un clic
    // sin `viewed_result_at`).
    //
    // La compra NO es un paso más: se puede comprar sin pulsar «Hablar con
    // Dayana» (un enlace de pago enviado por WhatsApp, por ejemplo). Como paso
    // anidado contaba 0 a quien sí compró sin ese clic; por eso va aparte, en
    // el KPI `purchased` sobre los que terminaron.
    prisma.$queryRaw<StepsRow[]>`
      SELECT
        COUNT(*) AS started,
        COUNT(*) FILTER (WHERE d."completed_at" IS NOT NULL) AS completed,
        COUNT(*) FILTER (
          WHERE d."completed_at" IS NOT NULL AND d."viewed_result_at" IS NOT NULL
        ) AS viewed,
        COUNT(*) FILTER (
          WHERE d."completed_at" IS NOT NULL AND d."viewed_result_at" IS NOT NULL
            AND d."checkout_started_at" IS NOT NULL
        ) AS clicked
      FROM "diagnostics" d
      WHERE d."created_at" >= ${from} AND d."created_at" < ${to}
    `,
    // KPIs por fecha de TERMINAR (`completed_at`), actual frente a anterior:
    // terminados, y de ellos cuántos compraron dentro de la ventana.
    prisma.$queryRaw<CompletedRow[]>`
      SELECT
        COUNT(*) FILTER (WHERE d."completed_at" >= ${from}) AS completed_current,
        COUNT(*) FILTER (WHERE d."completed_at" < ${prevTo}) AS completed_previous,
        COUNT(*) FILTER (WHERE d."completed_at" >= ${from} AND ${PURCHASED_SQL}) AS purchased_current,
        COUNT(*) FILTER (WHERE d."completed_at" < ${prevTo} AND ${PURCHASED_SQL}) AS purchased_previous
      FROM "diagnostics" d
      WHERE d."completed_at" >= ${prevFrom} AND d."completed_at" < ${to}
    `,
    // Origen, perfil y respuestas: sobre los terminados en el periodo (un
    // diagnóstico a medias no tiene perfil ni respuestas completas).
    prisma.diagnostic.groupBy({
      by: ["source"],
      where: completedInRange,
      _count: { _all: true },
    }),
    prisma.diagnostic.groupBy({
      by: ["profile"],
      where: completedInRange,
      _count: { _all: true },
    }),
    prisma.diagnostic.findMany({ where: completedInRange, select: { answers: true } }),
  ]);

  const steps = stepsRows[0];
  const kpis = completedRows[0];
  const profileLabels: Record<string, string> = PROFILE_SHORT_LABEL;

  return {
    steps: toFunnelSteps([
      { key: "started", label: FUNNEL_STEP_LABELS.started, count: toNumber(steps?.started) },
      { key: "completed", label: FUNNEL_STEP_LABELS.completed, count: toNumber(steps?.completed) },
      {
        key: "viewedResult",
        label: FUNNEL_STEP_LABELS.viewedResult,
        count: toNumber(steps?.viewed),
      },
      {
        key: "clickedContact",
        label: FUNNEL_STEP_LABELS.clickedContact,
        count: toNumber(steps?.clicked),
      },
    ]),
    completed: withDelta(toNumber(kpis?.completed_current), toNumber(kpis?.completed_previous)),
    purchased: withDelta(toNumber(kpis?.purchased_current), toNumber(kpis?.purchased_previous)),
    bySource: toBreakdownRows(
      sourceGroups.map((g) => ({
        key: g.source ?? NULL_KEY,
        label: diagnosticSourceLabel(g.source) ?? NO_SOURCE_LABEL,
        value: g._count._all,
      })),
    ),
    byProfile: toBreakdownRows(
      profileGroups.map((g) => ({
        key: g.profile ?? NULL_KEY,
        label: g.profile ? (profileLabels[g.profile] ?? g.profile) : NO_PROFILE_LABEL,
        value: g._count._all,
      })),
    ),
    answerDistribution: aggregateAnswerDistribution(answerRows.map((r) => r.answers)),
    attributionDays: ATTRIBUTION_DAYS,
  };
}
