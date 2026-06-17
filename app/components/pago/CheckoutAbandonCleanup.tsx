"use client";

import { useEffect, useRef } from "react";
import { isCheckoutReference } from "@/lib/crm/checkout-reference";

type Props = {
  enrollmentId?: string;
};

/** Best-effort cleanup of legacy placeholder checkout enrollments (pre-2026 flow). */
const CheckoutAbandonCleanup = ({ enrollmentId }: Props) => {
  const ran = useRef(false);

  useEffect(() => {
    const id = enrollmentId?.trim();
    if (!id || isCheckoutReference(id) || ran.current) return;
    ran.current = true;

    void fetch("/api/checkout/abandon", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enrollmentId: id }),
      keepalive: true,
    }).catch(() => {});
  }, [enrollmentId]);

  return null;
};

export default CheckoutAbandonCleanup;
