"use client";

import { useEffect, useState } from "react";
import type { Plan, PlanId } from "@/lib/plans";

type CheckoutPlanResponse = {
  plan: Plan;
  usdToCopRate: number;
};

/**
 * Plan de checkout desde el catálogo CRM (precio USD + COP aprox.).
 * Sin fallback estático: si la API falla, `error` queda en true y el modal
 * muestra el estado de error (mejor que cobrar precios desactualizados).
 */
export const useCheckoutPlan = (planId: PlanId | null) => {
  const [plan, setPlan] = useState<Plan | null>(null);
  const [usdToCopRate, setUsdToCopRate] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!planId) {
      setPlan(null);
      setUsdToCopRate(null);
      setLoading(false);
      setError(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(false);

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
        setPlan(null);
        setUsdToCopRate(null);
        setError(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [planId]);

  return { plan, usdToCopRate, loading, error };
};
