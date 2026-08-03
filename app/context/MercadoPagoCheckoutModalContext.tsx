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
import { pushDataLayerEvent } from "../../lib/analytics/dataLayer";
import { trackMetaEvent } from "../components/analytics/MetaPixel";

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
      // Ver nota en PayPalModalContext: el dataLayer no transmite por sí mismo.
      pushDataLayerEvent("begin_checkout", {
        plan_id: id,
        provider: "mercadopago",
      });
      // Ver nota en PayPalModalContext.
      trackMetaEvent("InitiateCheckout", {
        content_ids: [id],
        content_type: "product",
      });
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
