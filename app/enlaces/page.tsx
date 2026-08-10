import type { Metadata } from "next";
import { BRAND } from "@/lib/contact";
import LinktreePage from "@/app/components/enlaces/LinktreePage";
import { getFreeWebinar } from "@/lib/crm/free-webinar";
import { getServerUserCountry } from "@/lib/geo/user-country";

const title = `Enlaces — ${BRAND.name}`;
const description =
  "Todos los enlaces de Dayana Beltrán: WhatsApp, webinar gratuito, servicios, talleres, portal de miembros y redes sociales.";

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical: "/enlaces" },
  openGraph: { title, description, url: "/enlaces", type: "website" },
};

export const dynamic = "force-dynamic";

const Page = async () => {
  let webinarActive = false;
  let webinarCtaTitle = "Webinar gratuito";
  let webinarCtaSubtitle = "Registro webinar gratis en vivo";
  let webinarStartsAtIso: string | null = null;
  let webinarHasTime = true;

  const userCountry = await getServerUserCountry();

  try {
    const webinar = await getFreeWebinar();
    if (webinar?.isActive && webinar.startsAt && !webinar.endedAt) {
      webinarActive = true;
      webinarCtaTitle = "Webinar gratuito";
      webinarStartsAtIso = webinar.startsAtIso;
      webinarHasTime = webinar.startsAtHasTime;
      webinarCtaSubtitle = webinarHasTime
        ? "Webinar gratis en vivo"
        : "Fecha confirmada · hora por definir";
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
