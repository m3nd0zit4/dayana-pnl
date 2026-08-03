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
import { pushDataLayerEvent } from "../../lib/analytics/dataLayer";
import { trackMetaEvent } from "../components/analytics/MetaPixel";

export type OpenCheckoutOptions = {
  /** Try to resolve the contact from the signed-in session and skip the
   *  contact form when it's complete. */
  sessionFirst?: boolean;
};

type PayPalModalContextValue = {
  isOpen: boolean;
  planId: PlanId | null;
  openPayPal: (planId: PlanId, options?: OpenCheckoutOptions) => void;
  closePayPal: () => void;
};

const PayPalModalContext = createContext<PayPalModalContextValue | null>(null);

export const PayPalModalProvider = ({ children }: { children: ReactNode }) => {
  const [state, setState] = useState<{
    planId: PlanId;
    sessionFirst: boolean;
  } | null>(null);
  const openPayPal = useCallback((id: PlanId, options?: OpenCheckoutOptions) => {
    if (!isPlanId(id)) return;
    // El push al dataLayer es inerte por sí solo: nada sale del navegador hasta
    // que una etiqueta dispare, y eso lo gobierna Consent Mode.
    pushDataLayerEvent("begin_checkout", { plan_id: id, provider: "paypal" });
    // El Pixel solo existe si hubo consentimiento publicitario; `trackMetaEvent`
    // no hace nada cuando `fbq` no se cargó, así que no hace falta comprobarlo.
    trackMetaEvent("InitiateCheckout", { content_ids: [id], content_type: "product" });
    setState({ planId: id, sessionFirst: options?.sessionFirst === true });
  }, []);

  const closePayPal = useCallback(() => {
    setState(null);
  }, []);

  const value = useMemo<PayPalModalContextValue>(
    () => ({
      isOpen: state !== null,
      planId: state?.planId ?? null,
      openPayPal,
      closePayPal,
    }),
    [state, openPayPal, closePayPal]
  );

  return (
    <PayPalModalContext.Provider value={value}>
      {children}
      <PayPalModal
        planId={state?.planId ?? null}
        sessionFirst={state?.sessionFirst ?? false}
        onClose={closePayPal}
      />
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
