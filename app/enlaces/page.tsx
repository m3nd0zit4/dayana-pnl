import type { Metadata } from "next";
import { BRAND } from "@/lib/contact";
import LinktreePage from "@/app/components/enlaces/LinktreePage";
import { getFreeWebinar } from "@/lib/crm/free-webinar";
import { getServerUserCountry } from "@/lib/geo/user-country";

const title = `Enlaces — ${BRAND.name}`;
const description =
  "Todos los enlaces de Dayana Beltrán: WhatsApp, eventos gratuitos, servicios, talleres, portal de miembros y redes sociales.";

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical: "/enlaces" },
  openGraph: { title, description, url: "/enlaces", type: "website" },
};

export const dynamic = "force-dynamic";

const Page = async () => {
  let webinarActive = false;
  let webinarCtaTitle = "Evento gratuito";
  let webinarCtaSubtitle = "Regístrate gratis";
  let webinarStartsAtIso: string | null = null;
  let webinarHasTime = true;

  const userCountry = await getServerUserCountry();

  try {
    const webinar = await getFreeWebinar();
    // El botón se configura en el CRM (Eventos gratuitos → Botón en Enlaces).
    if (
      webinar?.isActive &&
      webinar.linkEnabled &&
      webinar.startsAt &&
      !webinar.endedAt
    ) {
      webinarActive = true;
      webinarCtaTitle = webinar.linkTitle?.trim() || webinar.eventLabel;
      webinarHasTime = webinar.startsAtHasTime;
      const customSubtitle = webinar.linkSubtitle?.trim();
      // Con subtítulo propio se muestra tal cual; sin él, la fecha en la hora
      // local de quien mira.
      webinarStartsAtIso = customSubtitle ? null : webinar.startsAtIso;
      webinarCtaSubtitle =
        customSubtitle ||
        (webinarHasTime
          ? `${webinar.eventLabel} en vivo`
          : "Fecha confirmada · hora por definir");
    }
  } catch {
    /* DB down — hide webinar CTA */
  }

  return (
    <LinktreePage
      webinarActive={webinarActive}
      webinarCtaTitle={webinarCtaTitle}
      webinarCtaSubtitle={webinarCtaSubtitle}
      webinarStartsAtIso={webinarStartsAtIso}
      webinarHasTime={webinarHasTime}
      userCountry={userCountry}
    />
  );
};

export default Page;
