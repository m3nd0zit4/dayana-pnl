import type { Metadata } from "next";
import { notFound } from "next/navigation";
import FreeWebinarPage from "@/app/components/webinar/FreeWebinarPage";
import { ensureFreeWebinar } from "@/lib/crm/free-webinar";
import { getServerUserCountry } from "@/lib/geo/user-country";
import { BRAND } from "@/lib/contact";
import { FREE_EVENT_PATH } from "@/lib/crm/free-webinar-publish";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const webinar = await ensureFreeWebinar();
  if (!webinar.isActive || !webinar.startsAt || webinar.endedAt) {
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
  const webinar = await ensureFreeWebinar();
  // `endedAt` cierra la landing igual que `isActive: false`: es una pagina
  // de registro, y dejarla viva con el CTA muerto no capta a nadie.
  if (!webinar.isActive || !webinar.startsAt || webinar.endedAt) notFound();

  const userCountry = await getServerUserCountry();

  return <FreeWebinarPage webinar={webinar} userCountry={userCountry} />;
};

export default Page;
