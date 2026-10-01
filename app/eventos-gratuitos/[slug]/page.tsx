import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import FreeEventEndedPage from "@/app/components/webinar/FreeEventEndedPage";
import FreeWebinarPage from "@/app/components/webinar/FreeWebinarPage";
import { BRAND } from "@/lib/contact";
import { eventDateLabel, isFreeEventMaterialDownloadable } from "@/lib/crm/free-events";
import { isFreeEventOpenRow } from "@/lib/crm/free-event-rules";
import { findFreeEventByPublicSlug, getOpenFreeEvent } from "@/lib/crm/free-webinar";
import { FREE_EVENT_PATH } from "@/lib/crm/free-webinar-publish";
import { getOperationalTimezone } from "@/lib/crm/operational-timezone";
import { getServerUserCountry } from "@/lib/geo/user-country";

export const dynamic = "force-dynamic";

type PageProps = { params: Promise<{ slug: string }> };

/**
 * La página propia de cada evento, como `/taller-virtual/<slug>`:
 *
 * - publicado → la landing con el formulario (su canónica es
 *   `/eventos-gratuitos`, la de siempre);
 * - inscripciones cerradas o ya realizado → qué pasó y el evento abierto;
 * - borrador → no existe todavía;
 * - una URL vieja redirige a la de ahora, y `gratuito` (el alias de antes)
 *   al evento actual.
 */
export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const found = await findFreeEventByPublicSlug(slug);
  if (found.kind !== "event" || found.event.status === "DRAFT") {
    return { title: `Eventos gratuitos | ${BRAND.name}`, robots: { index: false } };
  }
  const e = found.event;
  const title = e.metaTitle ?? `${e.headline} | ${BRAND.name}`;
  const description = e.metaDescription ?? e.subheadline ?? undefined;
  if (isFreeEventOpenRow(e)) {
    return {
      title,
      description,
      alternates: { canonical: FREE_EVENT_PATH },
      openGraph: { title, description, url: FREE_EVENT_PATH, type: "website" },
    };
  }
  return { title, description, robots: { index: false } };
}

const Page = async ({ params }: PageProps) => {
  const { slug } = await params;
  const found = await findFreeEventByPublicSlug(slug);
  if (found.kind === "current") permanentRedirect(FREE_EVENT_PATH);
  if (found.kind === "redirect") permanentRedirect(found.to);
  if (found.kind === "not_found") notFound();

  const event = found.event;
  if (event.status === "DRAFT") notFound();

  if (isFreeEventOpenRow(event)) {
    const userCountry = await getServerUserCountry();
    return <FreeWebinarPage webinar={event} userCountry={userCountry} />;
  }

  const [openEvent, tz] = await Promise.all([getOpenFreeEvent(), getOperationalTimezone()]);
  return (
    <FreeEventEndedPage
      event={event}
      openEvent={openEvent}
      materialDownloadable={isFreeEventMaterialDownloadable(event)}
      dateLabel={eventDateLabel(event, tz)}
    />
  );
};

export default Page;
