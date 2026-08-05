import type { Metadata } from "next";
import { BRAND } from "@/lib/contact";
import LinktreePage from "@/app/components/enlaces/LinktreePage";
import { getFreeWebinar } from "@/lib/crm/free-webinar";

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

  try {
    const webinar = await getFreeWebinar();
    if (webinar?.isActive && webinar.startsAt) {
      webinarActive = true;
      webinarCtaTitle = "Webinar gratuito";
      // Server-side label in CRM TZ as a hint; visitor page shows local time.
      webinarCtaSubtitle = webinar.startsAtDateKey
        ? webinar.startsAtHasTime && webinar.startsAtTimeHm
          ? `${webinar.startsAtDateKey} · ${webinar.startsAtTimeHm}`
          : webinar.startsAtDateKey
        : "Regístrate al webinar gratis en vivo";
    }
  } catch {
    /* DB down — hide webinar CTA */
  }

  return (
    <LinktreePage
      webinarActive={webinarActive}
      webinarCtaTitle={webinarCtaTitle}
      webinarCtaSubtitle={webinarCtaSubtitle}
    />
  );
};

export default Page;
