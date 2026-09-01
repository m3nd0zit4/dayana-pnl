/**
 * Tipos y helpers de presentación del catálogo. El catálogo vive en la DB
 * (Product + ProductPrice) — usar `getPublicPlans()` / `getPlanFromDb()` de
 * lib/plans-from-db.ts. El contenido inicial se siembra desde
 * prisma/seed-data.ts.
 */

/** Slug del producto en la DB (p. ej. "therapy-6", "course-live"). */
export type PlanId = string;

export type PlanKind = "therapy" | "course";

/** Titular bajo el precio; el detalle va en `features` (fichitas). */
export type TherapyPlanPresentation = {
  sessionsHeadline: string;
};

export type Plan = {
  id: PlanId;
  kind: PlanKind;
  title: string;
  sessions: string;
  /** Nº de sesiones del paquete (solo terapia). */
  sessionsCount?: number;
  /** Precio promocional cobrado (checkout). */
  amountUsd: number;
  /** Referencia COP aprox. en UI — calculada con la tasa USD→COP del CRM. */
  amountCop?: number;
  /** Precio lista en COP (calculado de listAmountUsd × tasa). */
  listAmountCop?: number;
  /**
   * Valor de referencia (lista) mayor que `amountUsd` cuando hay promoción.
   * Si no se define o es igual a `amountUsd`, la carta muestra un solo precio.
   */
  listAmountUsd?: number;
  /**
   * Portada del producto. Existía en `Product` desde siempre pero no en
   * `Plan`, así que sólo llegaba al público por la ruta del catálogo de
   * cursos: subir una imagen desde el CRM no cambiaba nada en la tarjeta de
   * una terapia.
   */
  imageUrl?: string;
  /** Solo curso u otros productos no terapia (p. ej. "por mes"). */
  unitPrice?: string;
  /**
   * Meses de acceso que concede un pago. Sólo lo llevan los dos productos de
   * membresía: 1 la mensualidad, 12 la anualidad. Es lo que permite pintarlas
   * juntas sin que ninguna de las dos sepa de la otra.
   */
  membershipMonths?: number;
  tag?: string;
  highlight?: boolean;
  /** Terapia: titular; curso: sin usar. Detalle en `features`. */
  therapyPresentation?: TherapyPlanPresentation;
  features: string[];
  whatsappMessage: string;
};

/** Ahorro en USD si hay lista por encima del precio promocional; si no, `null`. */
export function getTherapySavingsUsd(plan: Plan): number | null {
  if (plan.kind !== "therapy" || plan.listAmountUsd == null) return null;
  const save = plan.listAmountUsd - plan.amountUsd;
  return save > 0 ? save : null;
}

/** Valida la forma de un slug de plan (no consulta la DB — para eso `isActivePlanId`). */
export const isPlanId = (value: unknown): value is PlanId =>
  typeof value === "string" && /^[a-z0-9][a-z0-9-]*$/.test(value);

const usdFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

const copFormatter = new Intl.NumberFormat("es-CO", {
  style: "currency",
  currency: "COP",
  maximumFractionDigits: 0,
});

export const formatUsd = (usd: number): string => usdFormatter.format(usd);
export const formatCop = (cop: number): string => copFormatter.format(cop);
