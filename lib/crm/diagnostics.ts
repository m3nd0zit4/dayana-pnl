import { randomBytes } from "node:crypto";
import type { DiagnosticProfile, Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";
import { ensureContactTag } from "@/lib/crm/tags";
import {
  buildDiagnosticAnswers,
  type DiagnosticAnswerItem,
} from "@/lib/crm/diagnostic-answers";
import { displayContactPhone } from "@/lib/crm/contact-phone";
import {
  DIAGNOSTIC_PROFILES,
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

import type { WhatsAppMarks } from "./whatsapp-marks";
import { whatsAppMarksForDiagnostics } from "./whatsapp-touches";

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
  commitmentScore: number | null;
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
  commitmentScore: number | null;
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
  commitmentScore: true,
  recommendedProductId: true,
  source: true,
  completedAt: true,
  createdAt: true,
} as const;

/** Fuentes admitidas. Cualquier otra cosa se descarta: acaba en la analítica. */
const SOURCES = new Set([
  "enlaces",
  "home",
  "terapias",
  "cursos",
  "dayana",
  "historias",
  "webinar",
  "taller",
  "ad",
  // Quien comentó una palabra clave en un video y llegó por
  // `/material/<palabra>`. Sin esto el diagnóstico de esa campaña se guardaba
  // sin fuente y no había forma de saber qué video la trajo.
  "tiktok",
  "instagram",
  // `servicios` se queda por las filas antiguas: la ruta redirige a /terapias
  // pero los diagnósticos que ya se guardaron con esa fuente siguen ahí.
  "servicios",
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
  token: string | null | undefined,
  contactId: string,
  /**
   * Respuestas que trae el cliente. Se usan cuando no hay token — o cuando la
   * fila existe pero llegó vacía porque el autoguardado no pudo escribir.
   */
  fallbackAnswers?: unknown,
): Promise<DiagnosticRow | null> {
  const existing = token
    ? await prisma.diagnostic.findUnique({
        where: { token },
        select: { id: true, answers: true, completedAt: true, profile: true },
      })
    : null;

  // Sin fila que cerrar, se crea una aquí mismo.
  //
  // El token se pide al abrir el cuestionario y sirve para autoguardar y para
  // poder retomar; **no** hace falta para puntuar. Cuando esa petición falla
  // —el límite de peticiones es fácil de tocar probando, y el fallo es mudo—
  // la persona contestaba las ocho preguntas y se quedaba sin resultado. El
  // cliente lleva las respuestas en memoria de todos modos, así que aquí no
  // falta nada: se crea la fila con ellas y se cierra en el mismo paso.
  if (!existing) {
    const answers = sanitizeAnswers(fallbackAnswers);
    const score = scoreDiagnostic(answers);
    const row = await prisma.diagnostic.create({
      data: {
        token: newToken(),
        contactId,
        answers: answers as Prisma.InputJsonValue,
        profile: score.profile,
        urgencyScore: score.urgencyScore,
        commitmentScore: score.commitmentScore,
        recommendedProductId: await sellableProductId(score.recommendedProductId),
        completedAt: new Date(),
      },
      select: SELECT,
    });
    await tagContactWithProfile(contactId, score.profile);
    return toRow(row);
  }

  if (existing.completedAt) {
    const row = await prisma.diagnostic.update({
      where: { id: existing.id },
      data: { contactId },
      select: SELECT,
    });
    if (row.profile) await tagContactWithProfile(contactId, row.profile);
    return toRow(row);
  }

  // El autoguardado es best-effort, así que la fila puede haber quedado vacía
  // aunque el token exista. Lo que traiga el cliente manda en ese caso.
  const stored = sanitizeAnswers(existing.answers);
  const answers =
    Object.keys(stored).length > 0 ? stored : sanitizeAnswers(fallbackAnswers);
  const score = scoreDiagnostic(answers);

  const row = await prisma.diagnostic.update({
    where: { id: existing.id },
    data: {
      contactId,
      answers: answers as Prisma.InputJsonValue,
      profile: score.profile,
      urgencyScore: score.urgencyScore,
      commitmentScore: score.commitmentScore,
      recommendedProductId: await sellableProductId(score.recommendedProductId),
      completedAt: new Date(),
    },
    select: SELECT,
  });

  await tagContactWithProfile(contactId, score.profile);
  return toRow(row);
}

/**
 * Devuelve el slug sólo si ese producto existe de verdad.
 *
 * `recommendedProductId` es una **clave foránea real**. El scoring produce
 * slugs escritos a mano (`therapy-6`, `course-live`…), así que si alguien
 * renombra o borra un producto la escritura lanza P2003 — y el `catch` de
 * `/api/leads` se la traga, la ruta devuelve 200, y la página de resultado
 * responde 404 porque `completedAt` nunca llegó a escribirse. Perder la
 * recomendación es molesto; perder el diagnóstico entero, no.
 */
async function sellableProductId(id: string): Promise<string | null> {
  const found = await prisma.product
    .findUnique({ where: { id }, select: { id: true } })
    .catch(() => null);
  if (!found) {
    console.error(`[diagnostico] producto recomendado inexistente: ${id}`);
  }
  return found?.id ?? null;
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

/**
 * Sella que la persona pulsó el CTA principal del resultado. Antes era el
 * botón de pago; desde que el resultado no enseña precio es «Hablar con
 * Dayana» (WhatsApp). La columna conserva su nombre para no migrar.
 */
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
  /** Título del producto recomendado, no el slug — para no enseñarlo crudo. */
  recommendedProductTitle: string | null;
  /** Fue a WhatsApp y le escribiste, desde que hizo el diagnostico. */
  whatsapp: WhatsAppMarks;
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
    // Por fecha, lo más reciente primero (pedido de Dayana, 2026-09-19): así
    // se ve de un vistazo quién lo hizo hoy. «Calientes» sigue filtrando por
    // compromiso para responder a «¿a quién llamo primero?».
    orderBy: [{ completedAt: "desc" }, { createdAt: "desc" }],
    take: limit,
    select: {
      ...SELECT,
      checkoutStartedAt: true,
      // Título, no el id: la fila de lista lo enseña tal cual, y el slug del
      // producto no le dice nada a Dayana.
      product: { select: { title: true } },
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

  // Si fallan las marcas, la bandeja se abre igual, sin ellas.
  const marks = await whatsAppMarksForDiagnostics(
    rows.map((r) => ({
      id: r.id,
      contactId: r.contactId,
      createdAt: r.createdAt,
      checkoutStartedAt: r.checkoutStartedAt,
    })),
  ).catch(() => new Map<string, WhatsAppMarks>());

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
    recommendedProductTitle: row.product?.title ?? null,
    whatsapp: marks.get(row.id) ?? { leadAt: null, staffAt: null },
  }));
}

// ---------------------------------------------------------------------------
// Ficha de un diagnóstico y resumen embebido en la ficha de contacto.
//
// Ambos comparten forma (`ContactDiagnosticSummary`) porque la tarjeta de
// diagnósticos de la ficha de contacto y la página de detalle enseñan
// exactamente los mismos datos de resumen — la segunda sólo añade lo que
// necesita el detalle completo (token, timeline, datos del contacto).
// ---------------------------------------------------------------------------

export type ContactDiagnosticSummary = {
  id: string;
  profile: DiagnosticProfileId | null;
  /** Nombre del perfil ya traducido — `DIAGNOSTIC_PROFILES[profile].name`. */
  profileName: string | null;
  completedAt: string | null;
  source: string | null;
  recommendedProductTitle: string | null;
  answers: DiagnosticAnswerItem[];
};

const profileName = (profile: DiagnosticProfile | null): string | null =>
  profile ? DIAGNOSTIC_PROFILES[profile as DiagnosticProfileId].name : null;

const toIso = (d: Date | null): string | null => (d ? d.toISOString() : null);

/**
 * Diagnósticos completados de un contacto, el más reciente primero.
 *
 * Igual que `listCompletedDiagnostics`, sólo completados: uno abandonado no
 * tiene perfil ni respuestas que enseñar en la ficha.
 */
export async function listDiagnosticsForContact(
  contactId: string,
): Promise<ContactDiagnosticSummary[]> {
  const rows = await prisma.diagnostic.findMany({
    where: { contactId, completedAt: { not: null } },
    orderBy: { completedAt: "desc" },
    select: {
      id: true,
      answers: true,
      profile: true,
      completedAt: true,
      source: true,
      product: { select: { title: true } },
    },
  });

  return rows.map((row) => ({
    id: row.id,
    profile: row.profile as DiagnosticProfileId | null,
    profileName: profileName(row.profile),
    completedAt: toIso(row.completedAt),
    source: row.source,
    recommendedProductTitle: row.product?.title ?? null,
    answers: buildDiagnosticAnswers(row.answers),
  }));
}

export type DiagnosticDetail = ContactDiagnosticSummary & {
  token: string;
  urgencyScore: number | null;
  commitmentScore: number | null;
  createdAt: string;
  viewedResultAt: string | null;
  /** Ya no es «empezó el pago»: es «pulsó Hablar con Dayana». Ver el modelo. */
  checkoutStartedAt: string | null;
  /** Ultimo clic suyo hacia WhatsApp (resultado, correo, su cuenta). */
  whatsappLeadAt: string | null;
  /** Ultimo clic del equipo en WhatsApp con ella desde el CRM. */
  whatsappStaffAt: string | null;
  /** Mismo criterio que `hasPurchased` en la lista: alguna matrícula activa o completada. */
  isCustomer: boolean;
  contact: {
    id: string;
    name: string;
    email: string | null;
    phoneE164: string | null;
  } | null;
};

/** Ficha completa de un diagnóstico, para `/admin/diagnosticos/[id]`. */
export async function getDiagnosticById(id: string): Promise<DiagnosticDetail | null> {
  const row = await prisma.diagnostic.findUnique({
    where: { id },
    select: {
      id: true,
      token: true,
      answers: true,
      profile: true,
      urgencyScore: true,
      commitmentScore: true,
      source: true,
      completedAt: true,
      createdAt: true,
      viewedResultAt: true,
      checkoutStartedAt: true,
      product: { select: { title: true } },
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
  if (!row) return null;

  const marks = (
    await whatsAppMarksForDiagnostics([
      {
        id: row.id,
        contactId: row.contact?.id ?? null,
        createdAt: row.createdAt,
        checkoutStartedAt: row.checkoutStartedAt,
      },
    ]).catch(() => null)
  )?.get(row.id);

  return {
    id: row.id,
    token: row.token,
    profile: row.profile as DiagnosticProfileId | null,
    profileName: profileName(row.profile),
    completedAt: toIso(row.completedAt),
    source: row.source,
    recommendedProductTitle: row.product?.title ?? null,
    answers: buildDiagnosticAnswers(row.answers),
    urgencyScore: row.urgencyScore,
    commitmentScore: row.commitmentScore,
    createdAt: row.createdAt.toISOString(),
    viewedResultAt: toIso(row.viewedResultAt),
    checkoutStartedAt: toIso(row.checkoutStartedAt),
    whatsappLeadAt: toIso(marks?.leadAt ?? null),
    whatsappStaffAt: toIso(marks?.staffAt ?? null),
    isCustomer: (row.contact?.enrollments.length ?? 0) > 0,
    contact: row.contact
      ? {
          id: row.contact.id,
          name: [row.contact.firstName, row.contact.lastName]
            .filter(Boolean)
            .join(" "),
          email: row.contact.email,
          // Los contactos de Google/registro directo guardan un centinela en
          // vez de un teléfono real; no se enseña ni se manda a WhatsApp.
          phoneE164: displayContactPhone(row.contact.phoneE164),
        }
      : null,
  };
}
