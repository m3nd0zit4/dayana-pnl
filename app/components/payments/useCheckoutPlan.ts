"use client";

import { useEffect, useState } from "react";
import { getPlan, type Plan, type PlanId } from "@/lib/plans";

type CheckoutPlanResponse = {
  plan: Plan;
  usdToCopRate: number;
};

/**
 * Plan de checkout desde el catálogo CRM (precio USD + COP aprox.).
 * Fallback al catálogo estático si la API no responde.
 */
export const useCheckoutPlan = (planId: PlanId | null) => {
  const [plan, setPlan] = useState<Plan | null>(null);
  const [usdToCopRate, setUsdToCopRate] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!planId) {
      setPlan(null);
      setUsdToCopRate(null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);

    void fetch(`/api/plans/${planId}`, { cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) throw new Error("plan_fetch_failed");
        return res.json() as Promise<CheckoutPlanResponse>;
      })
      .then((data) => {
        if (cancelled) return;
        setPlan(data.plan);
        setUsdToCopRate(data.usdToCopRate);
      })
      .catch(() => {
        if (cancelled) return;
        setPlan(getPlan(planId));
        setUsdToCopRate(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [planId]);

  return { plan, usdToCopRate, loading };
};
