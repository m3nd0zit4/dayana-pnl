/**
 * Tipos y helpers de presentación del catálogo. El catálogo vive en la DB
 * (Product + ProductPrice) — usar `getPublicPlans()` / `getPlanFromDb()` de
 * lib/plans-from-db.ts. El contenido inicial se siembra desde
 * prisma/seed-data.ts.
 */

/** Slug del producto en la DB (p. ej. "therapy-6", "course-live"). */
export type PlanId = string;

/**
 * OJO: sólo distingue terapia de «lo demás». Un taller cae en `"course"`, así
 * que **`kind` no sirve para saber si algo se cobra cada mes** — usar
 * `recurring`. Confundirlos puso los botones de suscripción en el taller, que
 * es una compra única.
 */
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
  /** Solo curso u otros productos no terapia (p. ej. "por mes"). */
  unitPrice?: string;
  tag?: string;
  highlight?: boolean;
  /**
   * ¿Se cobra mes a mes? Sólo la mensualidad. Decide los textos del checkout
   * («Pagar un mes» en vez de «Pagar»).
   *
   * Es un hecho del producto, no una consecuencia de `kind`: un taller también
   * es `kind: "course"` y se paga una vez.
   */
  recurring?: boolean;
  /**
   * ¿Hay de verdad un plan recurrente creado en el proveedor?
   *
   * Sin esto el botón «Suscribirme» se pintaba siempre que el producto fuera
   * `kind: "course"` —incluido el taller—, y en el curso seguía apareciendo aun
   * cuando los planes no existen todavía: la clienta pulsaba y se llevaba un
   * error. Un botón que no puede funcionar no se enseña.
   */
  subscriptionAvailable?: boolean;
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
