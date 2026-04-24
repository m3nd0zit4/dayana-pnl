"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { isPlanId, type PlanId } from "../../lib/plans";
import PayPalModal from "../components/payments/PayPalModal";

type PayPalModalContextValue = {
  isOpen: boolean;
  planId: PlanId | null;
  openPayPal: (planId: PlanId) => void;
  closePayPal: () => void;
};

const PayPalModalContext = createContext<PayPalModalContextValue | null>(null);

export const PayPalModalProvider = ({ children }: { children: ReactNode }) => {
  const [planId, setPlanId] = useState<PlanId | null>(null);

  const openPayPal = useCallback((id: PlanId) => {
    if (!isPlanId(id)) return;
    setPlanId(id);
  }, []);

  const closePayPal = useCallback(() => {
    setPlanId(null);
  }, []);

  const value = useMemo<PayPalModalContextValue>(
    () => ({
      isOpen: planId !== null,
      planId,
      openPayPal,
      closePayPal,
    }),
    [planId, openPayPal, closePayPal]
  );

  return (
    <PayPalModalContext.Provider value={value}>
      {children}
      <PayPalModal planId={planId} onClose={closePayPal} />
    </PayPalModalContext.Provider>
  );
};

export const usePayPalModal = (): PayPalModalContextValue => {
  const ctx = useContext(PayPalModalContext);
  if (!ctx) {
    throw new Error("usePayPalModal must be used within a PayPalModalProvider");
  }
  return ctx;
};
