"use client";

import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { useCookieConsent } from "../../context/CookieConsentContext";
import { redactPrivateUrl } from "../../../lib/analytics/private-path";

/**
 * Monta Vercel Analytics y Speed Insights solo si el usuario aceptó cookies de analítica
 * y el despliegue permite cargarlas (producción/preview en Vercel).
 */
const ConsentBasedVercelInsights = () => {
  const { analyticsEnabled } = useCookieConsent();

  if (!analyticsEnabled) return null;

  return (
    <>
      {/* La dirección de una página personal (`/llamada/<token>`) viaja sin el secreto. */}
      <Analytics beforeSend={(event) => ({ ...event, url: redactPrivateUrl(event.url) })} />
      <SpeedInsights beforeSend={(data) => ({ ...data, url: redactPrivateUrl(data.url) })} />
    </>
  );
};

export default ConsentBasedVercelInsights;
