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
import MercadoPagoCardModal from "../components/payments/MercadoPagoCardModal";

type MercadoPagoCardModalContextValue = {
  isOpen: boolean;
  planId: PlanId | null;
  openCardModal: (planId: PlanId) => void;
  closeCardModal: () => void;
};

const MercadoPagoCardModalContext =
  createContext<MercadoPagoCardModalContextValue | null>(null);

export const MercadoPagoCardModalProvider = ({
  children,
}: {
  children: ReactNode;
}) => {
  const [planId, setPlanId] = useState<PlanId | null>(null);

  const openCardModal = useCallback((id: PlanId) => {
    if (!isPlanId(id)) return;
    setPlanId(id);
  }, []);

  const closeCardModal = useCallback(() => {
    setPlanId(null);
  }, []);

  const value = useMemo<MercadoPagoCardModalContextValue>(
    () => ({
      isOpen: planId !== null,
      planId,
      openCardModal,
      closeCardModal,
    }),
    [planId, openCardModal, closeCardModal]
  );

  return (
    <MercadoPagoCardModalContext.Provider value={value}>
      {children}
      <MercadoPagoCardModal planId={planId} onClose={closeCardModal} />
    </MercadoPagoCardModalContext.Provider>
  );
};

export const useMercadoPagoCardModal = (): MercadoPagoCardModalContextValue => {
  const ctx = useContext(MercadoPagoCardModalContext);
  if (!ctx) {
    throw new Error(
      "useMercadoPagoCardModal must be used within a MercadoPagoCardModalProvider"
    );
  }
  return ctx;
};
