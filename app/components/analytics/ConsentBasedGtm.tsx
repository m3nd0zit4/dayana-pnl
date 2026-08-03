"use client";

import { Suspense, useEffect } from "react";
import Script from "next/script";
import { useCookieConsent } from "../../context/CookieConsentContext";
import GtmRouteTracking from "./GtmRouteTracking";
import { pushDataLayerEvent } from "../../../lib/analytics/dataLayer";

/**
 * Contenedor de GTM.
 *
 * A diferencia de Vercel Analytics, el contenedor SÍ carga antes de que el
 * visitante decida: con Consent Mode v2 lo que se bloquea no es el script sino
 * lo que las etiquetas pueden hacer (sin cookies, sin datos publicitarios).
 * Ese es justamente el mecanismo que habilita el modelado de conversiones de
 * Google; no cargar nada lo desactiva por completo.
 *
 * Se omite a propósito el `<noscript><iframe>` del snippet oficial: carga sin
 * mirar el consentimiento y no lo puede aplicar, así que sería un agujero.
 */
const ConsentBasedGtm = () => {
  const { status, consent, analyticsAllowed } = useCookieConsent();
  const containerId = process.env.NEXT_PUBLIC_GTM_CONTAINER_ID;

  // Cada cambio de preferencias se propaga a las etiquetas ya cargadas.
  useEffect(() => {
    if (status !== "set") return;
    pushDataLayerEvent("consent_update", {
      consent_analytics: consent.analytics,
      consent_marketing: consent.marketing,
    });
    const w = window as unknown as { gtag?: (...args: unknown[]) => void };
    w.gtag?.("consent", "update", {
      analytics_storage: consent.analytics ? "granted" : "denied",
      ad_storage: consent.marketing ? "granted" : "denied",
      ad_user_data: consent.marketing ? "granted" : "denied",
      ad_personalization: consent.marketing ? "granted" : "denied",
    });
  }, [status, consent]);

  if (!analyticsAllowed || !containerId) return null;

  return (
    <>
      <Script id="gtm-bootstrap" strategy="afterInteractive">
        {`(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);})(window,document,'script','dataLayer','${containerId}');`}
      </Script>
      <Suspense fallback={null}>
        <GtmRouteTracking />
      </Suspense>
    </>
  );
};

export default ConsentBasedGtm;
