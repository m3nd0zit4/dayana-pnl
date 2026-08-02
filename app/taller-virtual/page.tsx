import type { Metadata } from "next";
import WorkshopsListing from "../components/home/WorkshopsListing";
import Footer from "../components/home/Footer";
import JsonLd from "../components/seo/JsonLd";
import { isGoogleAuthEnabled } from "@/auth";
import { getWorkshopsFromDb, getWorkshopEventTiming } from "@/lib/workshops-db";
import { getPlanFromDb } from "@/lib/plans-from-db";
import { getServerUserCountry } from "@/lib/geo/user-country";
import { isPlanVisibleForRegion } from "@/lib/pricing/plan-visibility";
import { resolveWorkshopAccess } from "@/lib/crm/workshop-access";
import type { Plan } from "@/lib/plans";
import { buildBreadcrumbSchema, buildWorkshopEventSchema } from "@/lib/seo/schema";

const title = "Talleres Virtuales | Dayana Beltrán PNL";
const description =
  "Talleres virtuales de transformación con Dayana Beltrán. Próxima edición en preparación; consulta por WhatsApp para avisarte de fechas, terapias o cursos en vivo.";

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical: "/taller-virtual" },
  openGraph: { title, description, url: "/taller-virtual", type: "website" },
};

// Reads geo headers per request (payment provider by country).
export const dynamic = "force-dynamic";

const WorkshopsPage = async () => {
  const [workshops, userCountry] = await Promise.all([
    getWorkshopsFromDb(),
    getServerUserCountry(),
  ]);

  // Event schema for the currently open edition, if any — sourced from real
  // DB dates, never fabricated. Rendered here (not on the gated [slug] page,
  // which redirects anonymous visitors away) since this listing is the page
  // crawlers actually see content on.
  const openCard = workshops.find((w) => w.status === "open");
  const eventTiming = openCard
    ? await getWorkshopEventTiming(openCard.slug)
    : null;
  const eventSchema =
    openCard && eventTiming?.startsAt
      ? buildWorkshopEventSchema({
          slug: openCard.slug,
          title: openCard.title,
          description: openCard.cardSummary,
          startsAt: eventTiming.startsAt,
          endsAt: eventTiming.endsAt,
          status: eventTiming.status,
        })
      : null;

  // Plan per open workshop (usually one) so the card can carry the real
  // payment button instead of a navigation link.
  const openProductIds = [
    ...new Set(
      workshops
        .filter((w) => w.status === "open" && w.productId)
        .map((w) => w.productId as string)
    ),
  ];
  const planEntries = await Promise.all(
    openProductIds.map(async (id) => [id, await getPlanFromDb(id)] as const)
  );
  const isColombia = userCountry === "CO";
  const plans: Record<string, Plan> = {};
  for (const [id, plan] of planEntries) {
    if (plan && isPlanVisibleForRegion(plan, isColombia)) plans[id] = plan;
  }

  // Owner (any status) or an already-enrolled visitor sees "Ver taller"
  // instead of a pay button — resolved once here so the card and the real
  // gate on /taller-virtual/[slug] can never disagree.
  const openWorkshops = workshops.filter((w) => w.status === "open");
  const accessEntries = await Promise.all(
    openWorkshops.map(
      async (w) =>
        [w.slug, (await resolveWorkshopAccess(w.productId ?? null)).hasAccess] as const
    )
  );
  const accessBySlug = Object.fromEntries(accessEntries);

  return (
    <>
      <JsonLd
        data={buildBreadcrumbSchema([
          { name: "Inicio", url: "/" },
          { name: "Talleres", url: "/taller-virtual" },
        ])}
      />
      {eventSchema && <JsonLd data={eventSchema} />}
      <main>
        <WorkshopsListing
          workshops={workshops}
          plans={plans}
          userCountry={userCountry}
          googleEnabled={isGoogleAuthEnabled()}
          accessBySlug={accessBySlug}
        />
      </main>
      <Footer />
    </>
  );
};

export default WorkshopsPage;
