import type { Metadata } from "next";
import { notFound } from "next/navigation";
import FreeWebinarPage from "@/app/components/webinar/FreeWebinarPage";
import { getOpenFreeEvent } from "@/lib/crm/free-webinar";
import { getServerUserCountry } from "@/lib/geo/user-country";
import { BRAND } from "@/lib/contact";
import { FREE_EVENT_PATH } from "@/lib/crm/free-webinar-publish";

export const dynamic = "force-dynamic";

/**
 * La dirección de siempre: el evento publicado ahora mismo. Cada evento tiene
 * además su página propia (`/eventos-gratuitos/<slug>`), pero esta es la que
 * va en la bio, los correos y los anuncios, y no cambia de un evento a otro.
 */
export async function generateMetadata(): Promise<Metadata> {
  const webinar = await getOpenFreeEvent();
  if (!webinar) {
    return {
      title: `Eventos gratuitos | ${BRAND.name}`,
      robots: { index: false },
    };
  }
  const title = webinar.metaTitle ?? `${webinar.eventLabel} | ${BRAND.name}`;
  const description =
    webinar.metaDescription ??
    webinar.subheadline ??
    `Regístrate gratis: ${webinar.headline}, con Dayana Beltrán.`;
  return {
    title,
    description,
    alternates: { canonical: FREE_EVENT_PATH },
    openGraph: {
      title,
      description,
      url: FREE_EVENT_PATH,
      type: "website",
    },
  };
}

const Page = async () => {
  // Solo el publicado, con fecha y sin terminar: es una página de registro, y
  // dejarla viva con el formulario muerto no capta a nadie.
  const webinar = await getOpenFreeEvent();
  if (!webinar) notFound();

  const userCountry = await getServerUserCountry();

  return <FreeWebinarPage webinar={webinar} userCountry={userCountry} />;
};

export default Page;
