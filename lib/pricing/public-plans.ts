import { getPublicPlans } from "../plans-from-db";
import { applyCopToPlan, getUsdToCopRateFromEnv } from "./usd-to-cop";
import type { Plan } from "../plans";
import { getServerUserCountry } from "../geo/user-country";

export type VisiblePublicPlans = {
  therapyPlans: Plan[];
  coursePlan: Plan | null;
  userCountry: string | null;
  isColombia: boolean;
};

/**
 * Planes públicos desde el CRM (DB), filtrados por región del visitante.
 * Los planes sin fila COP explícita muestran el COP aproximado por tasa —
 * igual que el checkout. Llama a headers() (país por IP) — la ruta que lo
 * use se vuelve dinámica.
 */
export const getVisiblePublicPlans = async (): Promise<VisiblePublicPlans> => {
  const [fromDb, userCountry] = await Promise.all([
    getPublicPlans().catch(() => null),
    getServerUserCountry().catch(() => null),
  ]);

  const rate = fromDb?.usdToCopRate ?? getUsdToCopRateFromEnv();
  const withApproxCop = (plan: Plan): Plan =>
    plan.amountCop == null ? applyCopToPlan(plan, rate) : plan;

  const therapyPlans = (fromDb?.therapyPlans ?? []).map(withApproxCop);
  const coursePlan = fromDb?.coursePlan
    ? withApproxCop(fromDb.coursePlan)
    : null;

  const isColombia = userCountry === "CO";

  // Ocultar planes sin precio para la región del visitante
  const visibleTherapyPlans = therapyPlans.filter((p) =>
    isColombia ? p.amountCop != null : p.amountUsd > 0
  );
  const visibleCoursePlan =
    coursePlan && (isColombia ? coursePlan.amountCop != null : coursePlan.amountUsd > 0)
      ? coursePlan
      : null;

  return {
    therapyPlans: visibleTherapyPlans,
    coursePlan: visibleCoursePlan,
    userCountry,
    isColombia,
  };
};
