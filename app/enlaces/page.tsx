import type { Metadata } from "next";
import { BRAND } from "@/lib/contact";
import LinktreePage from "@/app/components/enlaces/LinktreePage";
import { getOpenFreeEvent } from "@/lib/crm/free-webinar";
import { openWorkshopForRegistration } from "@/lib/crm/workshop-registration";
import { workshopRegistrationPath } from "@/lib/crm/workshop-registration-rules";
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

  // El taller con inscripciones abiertas (dueña, 28-oct: «cuando se crea un
  // taller aparezca ahí en la página de enlaces el botón del taller, que diga
  // "Taller" y abajo del taller el nombre»). Solo, sin ajuste en el CRM, y
  // lleva al registro; desaparece cuando empieza (`isRegistrationOpen`).
  let workshop: { title: string; href: string } | null = null;
  try {
    const open = await openWorkshopForRegistration();
    if (open) workshop = { title: open.title, href: `${workshopRegistrationPath(open.slug)}?ref=enlaces` };
  } catch {
    /* DB down — hide workshop CTA */
  }

  try {
    // El publicado, con fecha y sin terminar. El botón se configura en el CRM
    // (Eventos → el evento → Botón en Enlaces).
    const webinar = await getOpenFreeEvent();
    if (webinar?.linkEnabled) {
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
      workshop={workshop}
      userCountry={userCountry}
    />
  );
};

export default Page;
