"use client";

import { useEffect, useRef } from "react";

type Props = {
  enrollmentId?: string;
};

/** Best-effort cleanup of placeholder checkout rows when payment did not succeed. */
const CheckoutAbandonCleanup = ({ enrollmentId }: Props) => {
  const ran = useRef(false);

  useEffect(() => {
    const id = enrollmentId?.trim();
    if (!id || ran.current) return;
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
