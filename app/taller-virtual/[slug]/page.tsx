import type { Metadata } from "next";
import { WorkshopEditionStatus } from "@prisma/client";
import { notFound, redirect } from "next/navigation";
import WorkshopLanding from "@/app/components/home/WorkshopLanding";
import WorkshopSalesPage from "@/app/components/workshops/WorkshopSalesPage";
import Footer from "@/app/components/home/Footer";
import JsonLd from "@/app/components/seo/JsonLd";
import {
  getWorkshopDetailBySlugAnyStatus,
  getWorkshopDetailForPreview,
  getWorkshopMeetingUrl,
  getWorkshopMetaBySlug,
} from "@/lib/workshops-db";
import { getMemberSession } from "@/lib/auth/member-session";
import { getStaffSession } from "@/lib/auth/staff-session";
import { resolveSessionCheckoutContact } from "@/lib/crm/checkout-session-contact";
import { canManageTeam } from "@/lib/crm/staff-permissions";
import { hasActiveWorkshopEnrollment } from "@/lib/crm/workshop-access";
import {
  currentSlugForPrevious,
  isEnrolledInEdition,
  listWorkshopDocumentsBySlug,
} from "@/lib/crm/workshop-editions";
import { buildBreadcrumbSchema } from "@/lib/seo/schema";
import { getServerUserCountry } from "@/lib/geo/user-country";
import { getPlanFromDb } from "@/lib/plans-from-db";
import { isPlanVisibleForRegion } from "@/lib/pricing/plan-visibility";
import { isGoogleAuthEnabled } from "@/auth";
import type { Plan } from "@/lib/plans";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ slug: string }>;
};

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const meta = await getWorkshopMetaBySlug(slug);
  // DRAFT isn't public — same as today, where the OPEN-only lookup already
  // hid it. CLOSED/COMPLETED now get real metadata instead of a 404 title,
  // since the page renders a sales/closed state for them.
  if (!meta || meta.status === WorkshopEditionStatus.DRAFT) {
    return { title: "Taller no encontrado" };
  }
  const workshop = await getWorkshopDetailBySlugAnyStatus(slug);
  if (!workshop) return { title: "Taller no encontrado" };
  return {
    title: workshop.metadata.title,
    description: workshop.metadata.description,
    alternates: { canonical: `/taller-virtual/${slug}` },
    openGraph: {
      title: workshop.metadata.title,
      description: workshop.metadata.description,
      url: `/taller-virtual/${slug}`,
      type: "website",
    },
  };
}

const WorkshopDetailPage = async ({ params }: PageProps) => {
  const { slug } = await params;

  // OWNER always sees the real post-payment landing here, regardless of
  // whether she's actually enrolled — including for DRAFT/CLOSED editions,
  // so she can check a workshop before it goes live. Never applies to
  // anyone else, and never creates an Enrollment.
  const staff = await getStaffSession();
  const isOwnerPreview = Boolean(staff && canManageTeam(staff.role));

  const workshop = isOwnerPreview
    ? await getWorkshopDetailForPreview(slug)
    : await getWorkshopDetailBySlugAnyStatus(slug);
  if (!workshop) {
    // URL cambiada: los enlaces viejos (correos, WhatsApp) llevan a la nueva.
    // Después de buscar la actual, para que una URL vieja nunca tape a una
    // edición que hoy la usa. 307 y no 308: la URL se puede volver a cambiar.
    const renamedTo = await currentSlugForPrevious(slug);
    if (renamedTo) redirect(`/taller-virtual/${renamedTo}`);
    notFound();
  }

  const breadcrumb = (
    <JsonLd
      data={buildBreadcrumbSchema([
        { name: "Inicio", url: "/" },
        { name: "Talleres", url: "/taller-virtual" },
        { name: workshop.title, url: `/taller-virtual/${slug}` },
      ])}
    />
  );

  // Quién mira, si se sabe: decide el aviso «Ya estás inscrita» y el enlace
  // de la reunión, que piden haber pagado ESTA edición (no solo tener acceso).
  let viewerContactId: string | null = null;

  if (!isOwnerPreview) {
    const meta = await getWorkshopMetaBySlug(slug);
    const rawStatus = meta?.status ?? null;

    // DRAFT isn't public — same rule as today (the OPEN-only lookup used to
    // enforce this implicitly by returning null).
    if (rawStatus === WorkshopEditionStatus.DRAFT) notFound();

    let hasAccess = false;
    if (workshop.productId) {
      const member = await getMemberSession();
      if (member) {
        viewerContactId = member.contact.id;
        hasAccess = await hasActiveWorkshopEnrollment(
          member.contact.id,
          workshop.productId
        );
      } else {
        // Staff who bought the workshop (via their email-matched contact)
        // should see the landing too, not the pay button forever.
        const sessionContact = await resolveSessionCheckoutContact();
        if (sessionContact?.contactId) {
          viewerContactId = sessionContact.contactId;
          hasAccess = await hasActiveWorkshopEnrollment(
            sessionContact.contactId,
            workshop.productId
          );
        }
      }
    } else {
      // No product linked yet — nothing to pay for, so there's nothing to
      // gate; behave like today (fully public, WhatsApp-only).
      hasAccess = true;
    }

    // Not a buyer (and not the owner): a payment sales page at this same
    // URL, in place of the old redirect to the listing. Same page shape for
    // OPEN-with-a-price, OPEN-without-a-price, CLOSED and COMPLETED — only
    // the card content and CTA change.
    if (!hasAccess) {
      const userCountry = await getServerUserCountry();
      let plan: Plan | null = null;
      if (workshop.productId && rawStatus === WorkshopEditionStatus.OPEN) {
        const candidate = await getPlanFromDb(workshop.productId);
        const isColombia = userCountry === "CO";
        plan =
          candidate && isPlanVisibleForRegion(candidate, isColombia)
            ? candidate
            : null;
      }

      // OPEN with no visible plan for this visitor's region (no plan at
      // all, or one that exists but isn't visible for it) isn't the same as
      // registrations being closed — "unavailable" says so instead of
      // lying that inscriptions are closed.
      const state: "open" | "unavailable" | "closed" | "completed" =
        rawStatus === WorkshopEditionStatus.COMPLETED
          ? "completed"
          : rawStatus === WorkshopEditionStatus.OPEN
            ? plan
              ? "open"
              : "unavailable"
            : "closed";

      return (
        <>
          {breadcrumb}
          <main>
            <WorkshopSalesPage
              workshop={workshop}
              plan={plan}
              userCountry={userCountry}
              googleEnabled={isGoogleAuthEnabled()}
              capacity={meta?.capacity ?? null}
              state={state}
            />
          </main>
          <Footer />
        </>
      );
    }
  }

  const documents = await listWorkshopDocumentsBySlug(slug);
  const userCountry = await getServerUserCountry();
  // Tener acceso no basta: una edición sin producto es pública y una en el
  // producto compartido abre a quien compró cualquier taller anterior. El
  // enlace se pide aparte —nunca en `workshop`, el DTO que también usa
  // `WorkshopSalesPage`— y solo para OWNER o quien pagó esta edición.
  const enrolledHere =
    isOwnerPreview ||
    (viewerContactId !== null && (await isEnrolledInEdition(viewerContactId, slug)));
  const meetingUrl = enrolledHere ? await getWorkshopMeetingUrl(slug) : null;

  return (
    <>
      {breadcrumb}
      <main>
        <WorkshopLanding
          workshop={workshop}
          documents={documents}
          userCountry={userCountry}
          meetingUrl={meetingUrl}
          enrolled={enrolledHere}
        />
      </main>
      <Footer />
    </>
  );
};

export default WorkshopDetailPage;
