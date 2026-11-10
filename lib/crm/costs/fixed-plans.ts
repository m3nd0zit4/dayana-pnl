import type { CostServiceId } from "./catalog";
import type { BillLike } from "./rules";

/**
 * Los planes de precio fijo: lo que se paga cada mes a un proveedor que no
 * informa sus cobros por ninguna API (360dialog, Resend, Google Workspace…).
 *
 * El precio se escribe AQUÍ una vez y cuenta solo cada mes desde `since`; no
 * hay nada que registrar mes a mes. Se cambia cuando se cambia de plan: se
 * cierra la línea vieja con `until` y se añade una nueva, para que los meses
 * pasados sigan mostrando lo que de verdad se pagó.
 *
 * `usdCents: null` = todavía no se sabe el precio. Ese servicio sale en la
 * pantalla como «Falta el precio del plan» en vez de contarse como cero: un
 * cero callado haría creer que el total está completo. `usdCents: 0` es un
 * plan gratuito confirmado.
 */

export type FixedPlan = {
  serviceId: CostServiceId;
  label: string;
  /** Centavos de dólar al mes, o null si aún no se sabe. */
  usdCents: number | null;
  /** Desde cuándo se paga, `YYYY-MM-DD`. Obligatorio cuando hay precio. */
  since: string | null;
  /** Hasta cuándo se pagó este precio, `YYYY-MM-DD`. Sin él, sigue vigente. */
  until?: string;
};

export const FIXED_PLANS: FixedPlan[] = [
  { serviceId: "whatsapp", label: "Licencia de 360dialog", usdCents: null, since: null },
  { serviceId: "resend", label: "Plan de Resend", usdCents: null, since: null },
  { serviceId: "google", label: "Google Workspace", usdCents: null, since: null },
  { serviceId: "upstash", label: "Plan de Upstash", usdCents: null, since: null },
  { serviceId: "inngest", label: "Plan de Inngest", usdCents: null, since: null },
];

export type FixedPlanBill = BillLike & { id: string; label: string; note: null; fixed: true };

/** Los planes con precio, como facturas mensuales que nadie tiene que registrar. Puro. */
export const fixedPlanBills = (plans: FixedPlan[] = FIXED_PLANS): FixedPlanBill[] =>
  plans.flatMap((plan, index) =>
    plan.usdCents == null || !plan.since
      ? []
      : [
          {
            id: `fixed:${plan.serviceId}:${index}`,
            serviceId: plan.serviceId,
            label: plan.label,
            cadence: "MONTHLY" as const,
            currency: "USD" as const,
            amountMinor: plan.usdCents,
            startsOn: plan.since,
            endsOn: plan.until ?? null,
            note: null,
            fixed: true as const,
          },
        ],
  );

/** Los servicios con alguna línea a la que le falta el precio o la fecha. Puro. */
export const pendingFixedPlans = (plans: FixedPlan[] = FIXED_PLANS): CostServiceId[] => [
  ...new Set(plans.filter((p) => p.usdCents == null || !p.since).map((p) => p.serviceId)),
];
