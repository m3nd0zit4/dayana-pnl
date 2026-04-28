"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import MercadoPagoCheckoutModal from "../components/payments/MercadoPagoCheckoutModal";
import { isPlanId, type PlanId } from "../../lib/plans";

type MercadoPagoCheckoutModalContextValue = {
  isOpen: boolean;
  planId: PlanId | null;
  openMercadoPago: (planId: PlanId) => void;
  closeMercadoPago: () => void;
};

const MercadoPagoCheckoutModalContext =
  createContext<MercadoPagoCheckoutModalContextValue | null>(null);

export const MercadoPagoCheckoutModalProvider = ({
  children,
}: {
  children: ReactNode;
}) => {
  const [planId, setPlanId] = useState<PlanId | null>(null);

  const openMercadoPago = useCallback((id: PlanId) => {
    if (!isPlanId(id)) return;
    setPlanId(id);
  }, []);

  const closeMercadoPago = useCallback(() => {
    setPlanId(null);
  }, []);

  const value = useMemo<MercadoPagoCheckoutModalContextValue>(
    () => ({
      isOpen: planId !== null,
      planId,
      openMercadoPago,
      closeMercadoPago,
    }),
    [planId, openMercadoPago, closeMercadoPago]
  );

  return (
    <MercadoPagoCheckoutModalContext.Provider value={value}>
      {children}
      <MercadoPagoCheckoutModal planId={planId} onClose={closeMercadoPago} />
    </MercadoPagoCheckoutModalContext.Provider>
  );
};

export const useMercadoPagoCheckoutModal =
  (): MercadoPagoCheckoutModalContextValue => {
    const ctx = useContext(MercadoPagoCheckoutModalContext);
    if (!ctx) {
      throw new Error(
        "useMercadoPagoCheckoutModal must be used within MercadoPagoCheckoutModalProvider"
      );
    }
    return ctx;
  };
