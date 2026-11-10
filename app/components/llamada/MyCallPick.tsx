"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { trackMetaEvent } from "@/app/components/analytics/MetaPixel";
import { useCookieConsent } from "@/app/context/CookieConsentContext";
import { pushDataLayerEvent } from "@/lib/analytics/dataLayer";

import { useRememberToken } from "./MyCallHooks";
import { body, eyebrow, h1, lead as leadClass, surface, tapLink } from "./MyCallUi";
import { SlotPicker } from "./SlotPicker";

type Props = {
  token: string;
  /** El titular y la línea de debajo (cambian si canceló la que tenía). */
  heading: string;
  lead: string;
  /** wa.me para cuando no hay horas o el calendario no responde. */
  helpUrl: string;
};

/**
 * Quien dejó sus datos y todavía no tiene hora (o canceló la que tenía): el
 * selector de horas. Al agendar se mide la cita (Pixel `Schedule` + dataLayer
 * `call_funnel_booked`, nunca con el enlace de la persona) y se vuelve a pedir
 * la página: el servidor ya la devuelve con la llamada agendada.
 */
export const MyCallPick = ({ token, heading, lead, helpUrl }: Props) => {
  const router = useRouter();
  const { analyticsEnabled, marketingEnabled } = useCookieConsent();
  const [booked, setBooked] = useState(false);
  const [, startRefresh] = useTransition();
  useRememberToken(token);

  if (booked) {
    return (
      <div role="status">
        <p className={eyebrow}>Tu llamada gratis</p>
        <h1 className={`mt-4 ${h1}`}>Tu llamada quedó agendada</h1>
        <p className={`mt-4 ${body}`}>Estamos cargando tu página.</p>
        {/* Si la recarga no llega (sin señal), este enlace hace lo mismo. */}
        <a href={`/llamada/${encodeURIComponent(token)}`} className={`mt-1 ${tapLink}`}>
          Ver mi llamada
        </a>
      </div>
    );
  }

  return (
    <>
      <p className={eyebrow}>Tu llamada gratis</p>
      <h1 className={`mt-4 ${h1}`}>{heading}</h1>
      <p className={`mt-4 ${leadClass}`}>{lead}</p>
      <div className={`mt-8 p-5 sm:p-6 ${surface}`}>
        <SlotPicker
          token={token}
          submitLabel="Agendar mi llamada"
          helpUrl={helpUrl}
          onBooked={() => {
            setBooked(true);
            // El Pixel solo existe con permiso de publicidad (`MetaPixel`); el
            // dataLayer se llena solo con alguno de los dos permisos.
            trackMetaEvent("Schedule", { content_name: "llamada_gratis" });
            if (analyticsEnabled || marketingEnabled) pushDataLayerEvent("call_funnel_booked", { place: "mi_llamada" });
            startRefresh(() => router.refresh());
          }}
        />
      </div>
    </>
  );
};
