"use client";

import { useEffect, useRef } from "react";
import { useCookieConsent } from "../../context/CookieConsentContext";
import { pushDataLayerEvent } from "../../../lib/analytics/dataLayer";
import { trackMetaEvent } from "../analytics/MetaPixel";

type Props = {
  refLabel?: string;
  value?: number;
  currency?: "USD" | "COP";
  planId?: string;
  /**
   * `purchase.<paymentId>` — el MISMO id que manda la Conversions API desde
   * el servidor. Es lo único que evita que Meta cuente la compra dos veces.
   * Va sin valor cuando no se pudo resolver el pago, y entonces el Pixel no
   * dispara: solo cuenta el envío de servidor, que tampoco duplica.
   */
  eventId?: string;
};

/**
 * Purchase, lado navegador.
 *
 * Deduplicado con `localStorage` (sobrevive a un F5, cosa que
 * `sessionStorage` no) contra recargas de `/pago/exito`.
 */
const PurchaseConversionTracking = ({
  refLabel,
  value,
  currency,
  planId,
  eventId,
}: Props) => {
  const { analyticsEnabled, marketingEnabled } = useCookieConsent();
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    if (!analyticsEnabled && !marketingEnabled) return;

    const dedupeKey = `dayana_purchase_tracked_${eventId ?? refLabel ?? ""}`;
    if (!eventId && !refLabel) return;
    if (window.localStorage.getItem(dedupeKey)) return;

    ran.current = true;

    if (analyticsEnabled) {
      pushDataLayerEvent("purchase", {
        transaction_id: eventId ?? refLabel,
        value,
        currency,
        plan_id: planId,
      });
    }

    // El Pixel solo existe si hubo consentimiento publicitario; sin `eventId`
    // no se dispara, porque un Purchase sin id de deduplicación es peor que
    // ninguno: se sumaría al que ya mandó el servidor.
    if (marketingEnabled && eventId) {
      trackMetaEvent(
        "Purchase",
        { value, currency, content_ids: planId ? [planId] : undefined },
        eventId
      );
    }

    window.localStorage.setItem(dedupeKey, "1");
  }, [
    analyticsEnabled,
    marketingEnabled,
    refLabel,
    value,
    currency,
    planId,
    eventId,
  ]);

  return null;
};

export default PurchaseConversionTracking;
