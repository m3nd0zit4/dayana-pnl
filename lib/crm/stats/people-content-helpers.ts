import type { PaymentProvider } from "@prisma/client";

import { formatCountryLabel } from "@/lib/countries";

import type { ContentStats } from "./dto";

/**
 * Reshapes puros de «Contactos y membresías» y «Webinar, talleres y cursos».
 *
 * Sin Prisma, sin `server-only`: solo toman filas ya traídas (o primitivos) y
 * devuelven la forma final del DTO. Viven aparte de `people.ts`/`content.ts`
 * para poder probarlos sin base de datos.
 */

/* -------------------------------------------------------------------------
 * Miembros: foto fija de vigencia a un instante `now`
 * ---------------------------------------------------------------------- */

export type MembershipSnapshotRow = { paidUntil: Date | null };

export type MembershipSnapshot = {
  active: number;
  expiringThisWeek: number;
  expired: number;
};

/**
 * Cuenta activas / por vencer / vencidas a partir de filas YA filtradas por
 * `status: ACTIVE, lifetimeAccess: false, productId: <membresía>` (mismo
 * alcance que `lib/crm/pendientes.ts`). Se separa de la consulta para poder
 * probar el cálculo de fechas sin tocar la base de datos.
 *
 * `active` incluye `paidUntil: null`: una matrícula activa sin fecha de corte
 * todavía no ha vencido nada, así que cuenta como vigente.
 */
export function summarizeMembersSnapshot(
  rows: MembershipSnapshotRow[],
  now: Date,
  expiringWindowDays = 7,
): MembershipSnapshot {
  const nowMs = now.getTime();
  const inWindowMs = nowMs + expiringWindowDays * 24 * 60 * 60 * 1000;

  let active = 0;
  let expiringThisWeek = 0;
  let expired = 0;

  for (const row of rows) {
    const paidUntilMs = row.paidUntil ? row.paidUntil.getTime() : null;
    if (paidUntilMs === null || paidUntilMs >= nowMs) active += 1;
    if (paidUntilMs !== null && paidUntilMs >= nowMs && paidUntilMs < inWindowMs) {
      expiringThisWeek += 1;
    }
    if (paidUntilMs !== null && paidUntilMs < nowMs) expired += 1;
  }

  return { active, expiringThisWeek, expired };
}

/* -------------------------------------------------------------------------
 * Etiquetas
 * ---------------------------------------------------------------------- */

/** «Sin país» cuando el contacto no tiene `countryIso`. */
export function contactCountryLabel(iso: string | null): string {
  if (!iso) return "Sin país";
  return formatCountryLabel(iso);
}

/** Clave estable para agrupar por país, incluido el caso sin país. */
export function contactCountryKey(iso: string | null): string {
  return iso ?? "__sin-pais__";
}

export const SUBSCRIPTION_STATUS_LABELS: Record<string, string> = {
  ACTIVE: "Activa",
  SUSPENDED: "Suspendida",
  CANCELLED: "Cancelada",
  EXPIRED: "Vencida",
};

export const subscriptionStatusLabel = (status: string): string =>
  SUBSCRIPTION_STATUS_LABELS[status] ?? status;

export const SUBSCRIPTION_PROVIDER_LABELS: Record<string, string> = {
  PAYPAL: "PayPal",
  MERCADO_PAGO: "Mercado Pago",
  MANUAL: "Manual",
};

export const subscriptionProviderLabel = (provider: string): string =>
  SUBSCRIPTION_PROVIDER_LABELS[provider] ?? provider;

/**
 * Igual criterio que `lib/crm/subscriptions.ts`: manda el id de la
 * suscripción viva en el proveedor, no la columna `subscriptionProvider`
 * —que PayPal nunca escribió en las filas antiguas—, y solo se cae a esa
 * columna cuando ninguno de los dos ids está presente.
 */
export function resolveSubscriptionProvider(row: {
  paypalSubscriptionId: string | null;
  mercadoPagoPreapprovalId: string | null;
  subscriptionProvider: PaymentProvider | string | null;
}): string | null {
  if (row.paypalSubscriptionId) return "PAYPAL";
  if (row.mercadoPagoPreapprovalId) return "MERCADO_PAGO";
  return row.subscriptionProvider;
}

/**
 * Plural del pipeline de Estadísticas. Mismas etiquetas que el mapa privado
 * de `lib/crm/dashboard-stats.ts` (no exportado): se duplica a propósito en
 * vez de importarlo, porque ese módulo no es de este paquete.
 */
export const PIPELINE_STATUS_LABELS: Record<string, string> = {
  LEAD: "Leads",
  PENDING_PAYMENT: "Pago pendiente",
  ACTIVE: "Activos",
  COMPLETED: "Completados",
  CANCELLED: "Cancelados",
  REFUNDED: "Reembolsados",
};

export const pipelineStatusLabel = (status: string): string =>
  PIPELINE_STATUS_LABELS[status] ?? status;

/* -------------------------------------------------------------------------
 * Ediciones de taller
 * ---------------------------------------------------------------------- */

export type WorkshopEditionRow = {
  id: string;
  title: string;
  startsAt: Date;
  capacity: number | null;
};

/**
 * Filas de ediciones + su cupo vendido → forma final del DTO, ordenadas por
 * fecha de inicio ascendente (próximas primero, recientes al final de la
 * ventana). `seatsSoldById` trae solo los ids con al menos una matrícula:
 * los que faltan cuentan como 0, no se descartan.
 */
export function shapeWorkshopEditions(
  editions: WorkshopEditionRow[],
  seatsSoldById: Map<string, number>,
): ContentStats["workshops"]["editions"] {
  return [...editions]
    .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())
    .map((edition) => ({
      key: edition.id,
      label: edition.title,
      startsAt: edition.startsAt.toISOString(),
      seatsSold: seatsSoldById.get(edition.id) ?? 0,
      capacity: edition.capacity,
    }));
}

/* -------------------------------------------------------------------------
 * Ediciones del webinar gratuito
 * ---------------------------------------------------------------------- */

/**
 * Etiqueta de una edición del webinar: la fecha en es-CO larga, igual que
 * `WebinarEditionsPanel` en el historial de ediciones archivadas — "sin
 * fecha" es el mismo texto que usa ese panel para una edición sin programar.
 *
 * Se formatea en `timeZone` (la zona del rango de Estadísticas) y no en la
 * del servidor: `startsAt` es un instante UTC y el mismo instante cae en
 * distinto día calendario según la zona, igual que el resto de series de
 * este paquete.
 */
export function formatWebinarEditionLabel(
  edition: { startsAt: Date | null },
  timeZone: string,
): string {
  if (!edition.startsAt) return "sin fecha";
  return edition.startsAt.toLocaleDateString("es-CO", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone,
  });
}
