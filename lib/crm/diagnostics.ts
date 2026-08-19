import { randomBytes } from "node:crypto";
import type { DiagnosticProfile, Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";
import { ensureContactTag } from "@/lib/crm/tags";
import {
  PROFILE_TAG_LABEL,
  PROFILE_TAG_SLUG,
} from "@/lib/diagnostico/profiles";
import {
  sanitizeAnswers,
  type DiagnosticAnswers,
} from "@/lib/diagnostico/questions";
import {
  PRODUCT_FALLBACK_CHAIN,
  scoreDiagnostic,
  type DiagnosticProfileId,
} from "@/lib/diagnostico/scoring";
import { getPlanFromDb } from "@/lib/plans-from-db";
import { isPlanVisibleForRegion } from "@/lib/pricing/plan-visibility";
import type { Plan } from "@/lib/plans";

/**
 * Acceso a la tabla `diagnostics`. Igual que el resto del CRM, las rutas de
 * API no hablan con Prisma directamente (ver CLAUDE.md).
 */

/**
 * 32 caracteres hex = 128 bits. Deliberadamente no es un `cuid`: los cuid
 * llevan un contador y una marca de tiempo, así que conocer uno acota mucho el
 * espacio de los vecinos. La fila lleva respuestas personales; el token es lo
 * único que la protege.
 */
const newToken = () => randomBytes(16).toString("hex");

export type DiagnosticRow = {
  id: string;
  token: string;
  contactId: string | null;
  answers: DiagnosticAnswers;
  profile: DiagnosticProfile | null;
  urgencyScore: number | null;
  recommendedProductId: string | null;
  source: string | null;
  completedAt: Date | null;
  createdAt: Date;
};

const toRow = (row: {
  id: string;
  token: string;
  contactId: string | null;
  answers: Prisma.JsonValue;
  profile: DiagnosticProfile | null;
  urgencyScore: number | null;
  recommendedProductId: string | null;
  source: string | null;
  completedAt: Date | null;
  createdAt: Date;
}): DiagnosticRow => ({
  ...row,
  answers: sanitizeAnswers(row.answers),
});

const SELECT = {
  id: true,
  token: true,
  contactId: true,
  answers: true,
  profile: true,
  urgencyScore: true,
  recommendedProductId: true,
  source: true,
  completedAt: true,
  createdAt: true,
} as const;

/** Fuentes admitidas. Cualquier otra cosa se descarta: acaba en la analítica. */
const SOURCES = new Set([
  "enlaces",
  "home",
  "servicios",
  "webinar",
  "taller",
  "ad",
]);

export async function createDiagnostic(
  source?: string | null,
): Promise<DiagnosticRow> {
  const row = await prisma.diagnostic.create({
    data: {
      token: newToken(),
      answers: {},
      source: source && SOURCES.has(source) ? source : null,
    },
    select: SELECT,
  });
  return toRow(row);
}

export async function getDiagnosticByToken(
  token: string,
): Promise<DiagnosticRow | null> {
  const row = await prisma.diagnostic.findUnique({
    where: { token },
    select: SELECT,
  });
  return row ? toRow(row) : null;
}

/**
 * Guarda un paso. Las respuestas se **funden** con las que ya hubiera en vez
 * de reemplazarlas, para que volver atrás en el asistente y reenviar un único
 * paso no borre los demás.
 *
 * Un diagnóstico ya completado no se vuelve a tocar: el resultado que la
 * persona tiene abierto —y el que ve Dayana en el CRM— dejarían de coincidir.
 */
export async function patchDiagnosticAnswers(
  token: string,
  partial: unknown,
): Promise<DiagnosticRow | null> {
  const existing = await prisma.diagnostic.findUnique({
    where: { token },
    select: { id: true, answers: true, completedAt: true },
  });
  if (!existing || existing.completedAt) return null;

  const merged = {
    ...sanitizeAnswers(existing.answers),
    ...sanitizeAnswers(partial),
  };

  const row = await prisma.diagnostic.update({
    where: { id: existing.id },
    data: { answers: merged as Prisma.InputJsonValue },
    select: SELECT,
  });
  return toRow(row);
}

/**
 * Cierra el diagnóstico: puntúa, adjunta el contacto y le pone el tag de su
 * perfil.
 *
 * Es idempotente por diseño — `/api/leads` puede reintentarse y el formulario
 * puede reenviarse. Si ya estaba completo devuelve la fila tal cual, sin
 * repuntuar: repuntuar cambiaría la recomendación bajo los pies de alguien que
 * ya tiene la página de resultado abierta.
 */
export async function completeDiagnostic(
  token: string,
  contactId: string,
): Promise<DiagnosticRow | null> {
  const existing = await prisma.diagnostic.findUnique({
    where: { token },
    select: { id: true, answers: true, completedAt: true, profile: true },
  });
  if (!existing) return null;

  if (existing.completedAt) {
    const row = await prisma.diagnostic.update({
      where: { id: existing.id },
      data: { contactId },
      select: SELECT,
    });
    if (row.profile) await tagContactWithProfile(contactId, row.profile);
    return toRow(row);
  }

  const answers = sanitizeAnswers(existing.answers);
  const score = scoreDiagnostic(answers);

  const row = await prisma.diagnostic.update({
    where: { id: existing.id },
    data: {
      contactId,
      profile: score.profile,
      urgencyScore: score.urgencyScore,
      recommendedProductId: score.recommendedProductId,
      completedAt: new Date(),
    },
    select: SELECT,
  });

  await tagContactWithProfile(contactId, score.profile);
  return toRow(row);
}

async function tagContactWithProfile(
  contactId: string,
  profile: DiagnosticProfileId | DiagnosticProfile,
): Promise<void> {
  const key = profile as DiagnosticProfileId;
  await ensureContactTag(contactId, PROFILE_TAG_SLUG[key], PROFILE_TAG_LABEL[key]);
}

/**
 * Marcas de tiempo del embudo. `updateMany` con guarda de `null` para que
 * recargar la página de resultado no sobrescriba la primera visita: lo que se
 * mide es cuándo la vio por primera vez.
 */
export async function markDiagnosticViewed(token: string): Promise<void> {
  await prisma.diagnostic.updateMany({
    where: { token, viewedResultAt: null },
    data: { viewedResultAt: new Date() },
  });
}

export async function markDiagnosticCheckoutStarted(
  token: string,
): Promise<void> {
  await prisma.diagnostic.updateMany({
    where: { token, checkoutStartedAt: null },
    data: { checkoutStartedAt: new Date() },
  });
}

export type ResolvedRecommendation = {
  plan: Plan;
  /** True si hubo que degradar porque el recomendado no era vendible aquí. */
  substituted: boolean;
  upgrade: Plan | null;
};

/**
 * Resuelve el producto recomendado **en el momento de renderizar**, no el que
 * se guardó al completar. Entre una cosa y la otra el producto puede haberse
 * desactivado o quedarse sin precio en la moneda del visitante, y una página
 * de resultado sin botón de pago es un embudo roto.
 *
 * La columna `recommendedProductId` se conserva igualmente: sirve para medir
 * qué se recomendó frente a qué se compró.
 */
export async function resolveRecommendation(
  productId: string,
  upgradeProductId: string | null,
  isColombia: boolean,
): Promise<ResolvedRecommendation | null> {
  const sellable = async (id: string): Promise<Plan | null> => {
    const plan = await getPlanFromDb(id).catch(() => null);
    if (!plan) return null;
    return isPlanVisibleForRegion(plan, isColombia) ? plan : null;
  };

  const primary = await sellable(productId);
  if (primary) {
    return {
      plan: primary,
      substituted: false,
      upgrade: upgradeProductId ? await sellable(upgradeProductId) : null,
    };
  }

  for (const fallbackId of PRODUCT_FALLBACK_CHAIN[productId] ?? []) {
    const plan = await sellable(fallbackId);
    if (plan) return { plan, substituted: true, upgrade: null };
  }

  return null;
}

export type DiagnosticListRow = DiagnosticRow & {
  contact: {
    id: string;
    firstName: string;
    lastName: string | null;
    email: string | null;
    phoneE164: string;
  } | null;
  /** Si ese contacto ya tiene alguna inscripción pagada. */
  hasPurchased: boolean;
};

/**
 * Listado para `/admin/diagnosticos`. Sólo completados: los abandonados son
 * ruido en una bandeja de trabajo — su sitio es la métrica de embudo, no la
 * lista de personas a las que escribir.
 */
export async function listCompletedDiagnostics(
  limit = 100,
): Promise<DiagnosticListRow[]> {
  const rows = await prisma.diagnostic.findMany({
    where: { completedAt: { not: null } },
    orderBy: { completedAt: "desc" },
    take: limit,
    select: {
      ...SELECT,
      contact: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
          phoneE164: true,
          enrollments: {
            where: { status: { in: ["ACTIVE", "COMPLETED"] } },
            select: { id: true },
            take: 1,
          },
        },
      },
    },
  });

  return rows.map((row) => ({
    ...toRow(row),
    contact: row.contact
      ? {
          id: row.contact.id,
          firstName: row.contact.firstName,
          lastName: row.contact.lastName,
          email: row.contact.email,
          phoneE164: row.contact.phoneE164,
        }
      : null,
    hasPurchased: (row.contact?.enrollments.length ?? 0) > 0,
  }));
}
