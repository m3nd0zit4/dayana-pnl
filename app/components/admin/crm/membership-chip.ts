/**
 * «¿Cómo está esta persona?», en una etiqueta.
 *
 * Vivía dentro de `CourseMembersPageClient` y ahora lo leen dos pantallas —
 * Miembros y Suscripciones—, así que se saca aquí antes de que existan dos
 * copias. Es exactamente el caso que el resto del panel ya sufrió: dos lecturas
 * del mismo estado que se separan en el primer arreglo y a partir de ahí dicen
 * cosas distintas de la misma persona.
 *
 * El orden de las preguntas es el que importa:
 *
 * 1. **Cancelado o reembolsado** gana sobre todo lo demás. Alguien que canceló
 *    puede tener vigencia por delante —cancelar detiene la renovación, no el
 *    acceso ya pagado— y pintarla «Al día» escondería justo lo que hay que ver.
 * 2. **Sin vigencia** no es «vencido»: es que nunca hubo fecha. Un pago suelto
 *    de un curso de la biblioteca deja `paidUntil` en nulo a propósito.
 * 3. Y sólo entonces la fecha decide.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** Una semana de aviso: el margen para escribirle antes de que se caiga. */
const WARN_MS = 7 * DAY_MS;

export type MembershipChipInput = {
  status: string;
  paidUntil: string | null;
};

export type MembershipChip = {
  label: string;
  /** Clases del chip. Sólo tokens — ver `check:tokens`. */
  cls: string;
};

const MUTED = "border-border bg-muted text-muted-foreground";

export const membershipChip = (row: MembershipChipInput): MembershipChip => {
  if (row.status === "CANCELLED" || row.status === "REFUNDED") {
    return {
      label: row.status === "CANCELLED" ? "Cancelado" : "Reembolsado",
      cls: MUTED,
    };
  }
  if (!row.paidUntil) {
    return { label: "Sin vigencia", cls: MUTED };
  }

  const paidUntil = new Date(row.paidUntil).getTime();
  const now = Date.now();

  if (paidUntil <= now) {
    return {
      label: "Vencido",
      cls: "border-destructive/40 bg-destructive/10 text-destructive",
    };
  }
  if (paidUntil - now <= WARN_MS) {
    return {
      label: "Vence pronto",
      cls: "border-warning/40 bg-warning/10 text-warning",
    };
  }
  return { label: "Al día", cls: "border-success/40 bg-success/10 text-success" };
};
