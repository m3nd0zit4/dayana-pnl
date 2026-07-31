import type { Plan } from "../plans";

/**
 * True when `plan`'s price for the visitor's region is real — CO visitors
 * need an explicit COP row, everyone else need a positive USD price. No
 * currency is ever derived from the other; a missing price means "don't
 * show a pay button," not "show the wrong currency's amount." Shared by the
 * general catalog (lib/pricing/public-plans.ts) and every workshop
 * pay-button call site so there's exactly one place this rule can drift.
 */
export const isPlanVisibleForRegion = (
  plan: Pick<Plan, "amountUsd" | "amountCop">,
  isColombia: boolean
): boolean => (isColombia ? plan.amountCop != null && plan.amountCop > 0 : plan.amountUsd > 0);
