"use client";

import { Suspense, useEffect, useRef } from "react";
import Script from "next/script";
import { usePathname, useSearchParams } from "next/navigation";
import { useCookieConsent } from "../../context/CookieConsentContext";

/**
 * Meta Pixel.
 *
 * A diferencia de GTM, aquí NO se carga nada hasta que el visitante acepta
 * publicidad: Meta no tiene un equivalente a Consent Mode que justifique
 * cargar el script antes, así que la opción correcta es no cargarlo.
 *
 * Vive en código y no como etiqueta de GTM a propósito: el `eventID` del
 * Purchase tiene que coincidir exactamente con el que manda la Conversions
 * API, y hacerlo pasar por una variable del dataLayer y una etiqueta
 * configurada a mano en una interfaz web añade sitios donde puede romperse en
 * silencio justo lo que no puede romperse.
 */

declare global {
  interface Window {
    fbq?: ((...args: unknown[]) => void) & { callMethod?: unknown };
    _fbq?: unknown;
  }
}

/** Dispara PageView en cada navegación cliente (el App Router no recarga). */
const MetaPixelRouteTracking = () => {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const isFirstRender = useRef(true);

  useEffect(() => {
    // El PageView inicial ya lo manda el snippet de arranque.
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    window.fbq?.("track", "PageView");
  }, [pathname, searchParams]);

  return null;
};

const MetaPixel = () => {
  const { marketingEnabled } = useCookieConsent();
  const pixelId = process.env.NEXT_PUBLIC_META_PIXEL_ID;

  if (!marketingEnabled || !pixelId) return null;

  return (
    <>
      <Script id="meta-pixel" strategy="afterInteractive">
        {`!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');
fbq('init','${pixelId}');
fbq('track','PageView');`}
      </Script>
      <Suspense fallback={null}>
        <MetaPixelRouteTracking />
      </Suspense>
    </>
  );
};

export default MetaPixel;

/** Dispara un evento solo si el Pixel llegó a cargar (consentimiento dado). */
export const trackMetaEvent = (
  eventName: string,
  params?: Record<string, unknown>,
  eventId?: string
): void => {
  if (typeof window === "undefined" || !window.fbq) return;
  window.fbq("track", eventName, params ?? {}, eventId ? { eventID: eventId } : undefined);
};
