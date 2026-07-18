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

import type { OpenCheckoutOptions } from "./PayPalModalContext";

type MercadoPagoCheckoutModalContextValue = {
  isOpen: boolean;
  planId: PlanId | null;
  openMercadoPago: (planId: PlanId, options?: OpenCheckoutOptions) => void;
  closeMercadoPago: () => void;
};

const MercadoPagoCheckoutModalContext =
  createContext<MercadoPagoCheckoutModalContextValue | null>(null);

export const MercadoPagoCheckoutModalProvider = ({
  children,
}: {
  children: ReactNode;
}) => {
  const [state, setState] = useState<{
    planId: PlanId;
    sessionFirst: boolean;
  } | null>(null);

  const openMercadoPago = useCallback(
    (id: PlanId, options?: OpenCheckoutOptions) => {
      if (!isPlanId(id)) return;
      setState({ planId: id, sessionFirst: options?.sessionFirst === true });
    },
    []
  );

  const closeMercadoPago = useCallback(() => {
    setState(null);
  }, []);

  const value = useMemo<MercadoPagoCheckoutModalContextValue>(
    () => ({
      isOpen: state !== null,
      planId: state?.planId ?? null,
      openMercadoPago,
      closeMercadoPago,
    }),
    [state, openMercadoPago, closeMercadoPago]
  );

  return (
    <MercadoPagoCheckoutModalContext.Provider value={value}>
      {children}
      <MercadoPagoCheckoutModal
        planId={state?.planId ?? null}
        sessionFirst={state?.sessionFirst ?? false}
        onClose={closeMercadoPago}
      />
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
