import type { Metadata } from "next";
import { notFound } from "next/navigation";
import FreeWebinarPage from "@/app/components/webinar/FreeWebinarPage";
import { ensureFreeWebinar } from "@/lib/crm/free-webinar";
import { getServerUserCountry } from "@/lib/geo/user-country";
import { BRAND } from "@/lib/contact";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const webinar = await ensureFreeWebinar();
  if (!webinar.isActive || !webinar.startsAt || webinar.endedAt) {
    return { title: `Webinar | ${BRAND.name}`, robots: { index: false } };
  }
  const title = webinar.metaTitle ?? `Webinar gratuito | ${BRAND.name}`;
  const description =
    webinar.metaDescription ??
    webinar.subheadline ??
    "Regístrate al webinar gratuito en vivo con Dayana Beltrán.";
  return {
    title,
    description,
    alternates: { canonical: "/webinar-gratuito" },
    openGraph: {
      title,
      description,
      url: "/webinar-gratuito",
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
