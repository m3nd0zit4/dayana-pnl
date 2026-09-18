import type { Metadata } from "next";
import { redirect } from "next/navigation";

import WhatsAppHop from "@/app/components/whatsapp/WhatsAppHop";
import { buildWhatsAppUrl } from "@/lib/contact";
import { decodeWhatsAppRedirect } from "@/lib/crm/whatsapp-redirect";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "WhatsApp",
  robots: { index: false, follow: false },
};

/**
 * Parada intermedia de los enlaces de WhatsApp de los correos: registra el
 * clic (desde el navegador, ver `WhatsAppHop`) y abre WhatsApp.
 *
 * Un código roto o manipulado no deja a nadie sin escribir: se le manda al
 * WhatsApp de Dayana sin registrar nada.
 */
const WhatsAppRedirectPage = async ({
  params,
}: {
  params: Promise<{ code: string }>;
}) => {
  const { code } = await params;
  const payload = decodeWhatsAppRedirect(code);
  if (!payload) redirect(buildWhatsAppUrl("Hola Dayana"));

  return (
    <>
      <noscript>
        <meta httpEquiv="refresh" content={`0;url=${payload.target}`} />
      </noscript>
      <WhatsAppHop code={code} target={payload.target} />
    </>
  );
};

export default WhatsAppRedirectPage;
