"use client";

import { MessageCircle } from "lucide-react";

import { trackMetaEvent } from "@/app/components/analytics/MetaPixel";
import { pushDataLayerEvent } from "@/lib/analytics/dataLayer";

type Props = {
  /** `wa.me` con el resultado ya escrito en el mensaje. */
  href: string;
  /** Token del diagnóstico, para sellar que pulsó el CTA. */
  token: string;
  profile: string;
  label: string;
  className?: string;
};

/**
 * El CTA principal del resultado: hablar con Dayana por WhatsApp.
 *
 * Sustituye al botón de pago. Sigue sellando `checkoutStartedAt` con la misma
 * ruta, así «leyó el resultado y se fue» y «quiso hablar» se siguen pudiendo
 * distinguir sin migrar nada.
 *
 * Es un `<a>` de verdad y no hace `preventDefault`: si la telemetría falla, o
 * el JavaScript no llegó a cargar, WhatsApp se abre igual.
 */
const DiagnosticContactCta = ({ href, token, profile, label, className = "" }: Props) => {
  const handleClick = () => {
    void fetch(`/api/diagnostico/${token}/checkout`, {
      method: "POST",
      keepalive: true,
    }).catch(() => {});
    pushDataLayerEvent("contact_whatsapp", { source: "diagnostic_result", profile });
    trackMetaEvent("Contact", { content_name: "diagnostic_result", profile });
  };

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      onClick={handleClick}
      className={`flex w-full items-center justify-center gap-3 rounded-full bg-ink px-6 py-4 font-[font2] text-xs uppercase tracking-[0.18em] text-paper shadow-[0_8px_20px_rgba(20,17,24,0.18)] transition-all duration-200 hover:-translate-y-0.5 hover:bg-black active:translate-y-0 active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2 ${className}`}
    >
      <MessageCircle className="h-5 w-5" aria-hidden="true" />
      {label}
    </a>
  );
};

export default DiagnosticContactCta;
