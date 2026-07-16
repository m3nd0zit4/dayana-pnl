"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { Plan } from "../../../lib/plans";
import PlanCheckoutButtons from "../payments/PlanCheckoutButtons";
import { usePayPalModal } from "../../context/PayPalModalContext";
import { useMercadoPagoCheckoutModal } from "../../context/MercadoPagoCheckoutModalContext";

type WorkshopPaymentSectionProps = {
  plan: Plan | null;
  userCountry?: string | null;
};

/**
 * Wraps PlanCheckoutButtons and, if the visitor just landed here via the
 * account-creation redirect (?autopay=1 — set by AccountAccessCard's
 * callbackUrl), opens the payment modal automatically on mount so creating
 * an account and paying feel like one continuous step. The query param is
 * stripped right after so a page refresh doesn't reopen the modal.
 */
const WorkshopPaymentSection = ({
  plan,
  userCountry,
}: WorkshopPaymentSectionProps) => {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const { openPayPal } = usePayPalModal();
  const { openMercadoPago } = useMercadoPagoCheckoutModal();
  const triggered = useRef(false);

  useEffect(() => {
    if (triggered.current) return;
    if (searchParams.get("autopay") !== "1") return;
    if (!plan) return;
    triggered.current = true;

    if (userCountry === "CO") {
      openMercadoPago(plan.id);
    } else {
      openPayPal(plan.id);
    }

    const cleaned = new URLSearchParams(searchParams);
    cleaned.delete("autopay");
    const query = cleaned.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, {
      scroll: false,
    });
    // Intentionally mount-only: this must fire once per navigation into the
    // page, not re-fire on every searchParams/plan reference change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!plan) {
    return (
      <p className="text-sm text-white/60">
        El pago en línea para este taller aún no está configurado.
      </p>
    );
  }

  return <PlanCheckoutButtons plan={plan} isDark userCountry={userCountry} />;
};

export default WorkshopPaymentSection;
