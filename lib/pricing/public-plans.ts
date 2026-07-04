import { getPublicPlans } from "../plans-from-db";
import { resolveUsdToCopRate } from "../crm/site-settings";
import {
  applyCopToPlan,
  applyCopToPlans,
  getUsdToCopRateFromEnv,
} from "./usd-to-cop";
import { COURSE_PLAN, THERAPY_PLANS, type Plan } from "../plans";
import { getServerUserCountry } from "../geo/user-country";

export type VisiblePublicPlans = {
  therapyPlans: Plan[];
  coursePlan: Plan | null;
  userCountry: string | null;
  isColombia: boolean;
};

/**
 * Planes públicos con precios vivos del CRM (fallback estático con COP por
 * tasa), filtrados por región del visitante. Usado por la landing y /servicios.
 * Llama a headers() (país por IP) — la ruta que lo use se vuelve dinámica.
 */
export const getVisiblePublicPlans = async (): Promise<VisiblePublicPlans> => {
  const [rate, userCountry] = await Promise.all([
    resolveUsdToCopRate().catch(() => getUsdToCopRateFromEnv()),
    getServerUserCountry().catch(() => null),
  ]);
  let therapyPlans = applyCopToPlans(THERAPY_PLANS, rate);
  let coursePlan: Plan | null = applyCopToPlan(COURSE_PLAN, rate);

  const isColombia = userCountry === "CO";

  try {
    const fromDb = await getPublicPlans();
    if (fromDb.therapyPlans.length > 0) therapyPlans = fromDb.therapyPlans;
    if (fromDb.coursePlan) coursePlan = fromDb.coursePlan;
  } catch {
    /* catálogo estático con COP según tasa */
  }

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
