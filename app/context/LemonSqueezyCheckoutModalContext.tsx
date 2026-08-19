"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import LemonSqueezyCheckoutModal from "../components/payments/LemonSqueezyCheckoutModal";
import { isPlanId, type PlanId } from "../../lib/plans";
import { pushDataLayerEvent } from "../../lib/analytics/dataLayer";
import { trackMetaEvent } from "../components/analytics/MetaPixel";

export type OpenCheckoutOptions = { sessionFirst?: boolean };

type Value = {
  isOpen: boolean;
  planId: PlanId | null;
  openLemonSqueezy: (planId: PlanId, options?: OpenCheckoutOptions) => void;
  closeLemonSqueezy: () => void;
};

const Ctx = createContext<Value | null>(null);

export const LemonSqueezyCheckoutModalProvider = ({
  children,
}: {
  children: ReactNode;
}) => {
  const [state, setState] = useState<{
    planId: PlanId;
    sessionFirst: boolean;
  } | null>(null);

  const openLemonSqueezy = useCallback(
    (id: PlanId, options?: OpenCheckoutOptions) => {
      if (!isPlanId(id)) return;
      // Igual que en los otros proveedores: el dataLayer no transmite solo.
      pushDataLayerEvent("begin_checkout", {
        plan_id: id,
        provider: "lemonsqueezy",
      });
      trackMetaEvent("InitiateCheckout", {
        content_ids: [id],
        content_type: "product",
      });
      setState({ planId: id, sessionFirst: options?.sessionFirst === true });
    },
    [],
  );

  const closeLemonSqueezy = useCallback(() => setState(null), []);

  const value = useMemo<Value>(
    () => ({
      isOpen: state !== null,
      planId: state?.planId ?? null,
      openLemonSqueezy,
      closeLemonSqueezy,
    }),
    [state, openLemonSqueezy, closeLemonSqueezy],
  );

  return (
    <Ctx.Provider value={value}>
      {children}
      <LemonSqueezyCheckoutModal
        planId={state?.planId ?? null}
        onClose={closeLemonSqueezy}
      />
    </Ctx.Provider>
  );
};

export const useLemonSqueezyCheckoutModal = (): Value => {
  const ctx = useContext(Ctx);
  if (!ctx) {
    throw new Error(
      "useLemonSqueezyCheckoutModal must be used within LemonSqueezyCheckoutModalProvider",
    );
  }
  return ctx;
};
