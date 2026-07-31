import { getPublicPlans } from "../plans-from-db";
import type { Plan } from "../plans";
import { getServerUserCountry } from "../geo/user-country";
import { isPlanVisibleForRegion } from "./plan-visibility";

export type VisiblePublicPlans = {
  therapyPlans: Plan[];
  coursePlan: Plan | null;
  userCountry: string | null;
  isColombia: boolean;
};

/**
 * Planes públicos desde el CRM (DB), filtrados por región del visitante.
 * Sin precio explícito en la moneda de la región, el plan NO se muestra —
 * no se deriva ningún COP automático; el precio que se ve (y se cobra) es
 * siempre el que está escrito en el CRM. Llama a headers() (país por IP) —
 * la ruta que lo use se vuelve dinámica.
 */
export const getVisiblePublicPlans = async (): Promise<VisiblePublicPlans> => {
  const [fromDb, userCountry] = await Promise.all([
    getPublicPlans().catch(() => null),
    getServerUserCountry().catch(() => null),
  ]);

  const therapyPlans = fromDb?.therapyPlans ?? [];
  const coursePlan = fromDb?.coursePlan ?? null;

  const isColombia = userCountry === "CO";

  // Visible solo con precio explícito para la región del visitante.
  const visibleForRegion = (p: Plan) => isPlanVisibleForRegion(p, isColombia);

  const visibleTherapyPlans = therapyPlans.filter(visibleForRegion);
  const visibleCoursePlan =
    coursePlan && visibleForRegion(coursePlan) ? coursePlan : null;

  return {
    therapyPlans: visibleTherapyPlans,
    coursePlan: visibleCoursePlan,
    userCountry,
    isColombia,
  };
};
