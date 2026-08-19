"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import CheckoutConfirmModal from "../components/payments/CheckoutConfirmModal";
import type { CheckoutProvider } from "../components/payments/startCheckout";
import { isPlanId, type PlanId } from "../../lib/plans";
import { pushDataLayerEvent } from "../../lib/analytics/dataLayer";
import { trackMetaEvent } from "../components/analytics/MetaPixel";

type Value = {
  isOpen: boolean;
  planId: PlanId | null;
  openCheckout: (planId: PlanId, provider: CheckoutProvider) => void;
  closeCheckout: () => void;
};

const Ctx = createContext<Value | null>(null);

/**
 * Un solo modal de confirmación para PayPal y Mercado Pago. Sustituye a los dos
 * contextos anteriores, que existían para hospedar el formulario de datos —
 * ahora los datos llegan del proveedor tras el pago.
 */
export const CheckoutModalProvider = ({ children }: { children: ReactNode }) => {
  const [state, setState] = useState<{
    planId: PlanId;
    provider: CheckoutProvider;
  } | null>(null);

  const openCheckout = useCallback(
    (id: PlanId, provider: CheckoutProvider) => {
      if (!isPlanId(id)) return;
      // El dataLayer no transmite por sí mismo; hay que empujarlo aquí.
      pushDataLayerEvent("begin_checkout", { plan_id: id, provider });
      trackMetaEvent("InitiateCheckout", {
        content_ids: [id],
        content_type: "product",
      });
      setState({ planId: id, provider });
    },
    []
  );

  const closeCheckout = useCallback(() => setState(null), []);

  const value = useMemo<Value>(
    () => ({
      isOpen: state !== null,
      planId: state?.planId ?? null,
      openCheckout,
      closeCheckout,
    }),
    [state, openCheckout, closeCheckout]
  );

  return (
    <Ctx.Provider value={value}>
      {children}
      <CheckoutConfirmModal
        planId={state?.planId ?? null}
        provider={state?.provider ?? "paypal"}
        onClose={closeCheckout}
      />
    </Ctx.Provider>
  );
};

export const useCheckoutModal = (): Value => {
  const ctx = useContext(Ctx);
  if (!ctx) {
    throw new Error("useCheckoutModal must be used within CheckoutModalProvider");
  }
  return ctx;
};
