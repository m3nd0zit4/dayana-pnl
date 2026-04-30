"use client";

import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { useCookieConsent } from "../../context/CookieConsentContext";

/**
 * Monta Vercel Analytics y Speed Insights solo si el usuario aceptó cookies de analítica
 * y el despliegue permite cargarlas (producción/preview en Vercel).
 */
const ConsentBasedVercelInsights = () => {
  const { status, analyticsAllowed } = useCookieConsent();

  if (status !== "accepted" || !analyticsAllowed) return null;

  return (
    <>
      <Analytics />
      <SpeedInsights />
    </>
  );
};

export default ConsentBasedVercelInsights;
