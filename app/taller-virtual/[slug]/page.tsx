import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import WorkshopLanding from "@/app/components/home/WorkshopLanding";
import Footer from "@/app/components/home/Footer";
import JsonLd from "@/app/components/seo/JsonLd";
import { getOpenWorkshopDetailBySlug } from "@/lib/workshops-db";
import { getMemberSession } from "@/lib/auth/member-session";
import { resolveSessionCheckoutContact } from "@/lib/crm/checkout-session-contact";
import { hasActiveWorkshopEnrollment } from "@/lib/crm/workshop-access";
import { listWorkshopDocumentsBySlug } from "@/lib/crm/workshop-editions";
import { buildBreadcrumbSchema } from "@/lib/seo/schema";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ slug: string }>;
};

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const workshop = await getOpenWorkshopDetailBySlug(slug);
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
  const workshop = await getOpenWorkshopDetailBySlug(slug);
  if (!workshop) notFound();

  let hasAccess = false;
  if (workshop.productId) {
    const member = await getMemberSession();
    if (member) {
      hasAccess = await hasActiveWorkshopEnrollment(
        member.contact.id,
        workshop.productId
      );
    } else {
      // Staff who bought the workshop (via their email-matched contact)
      // should see the landing too, not the pay button forever.
      const sessionContact = await resolveSessionCheckoutContact();
      if (sessionContact?.contactId) {
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

  // The details page doesn't exist for people who haven't paid — send them
  // back to the listing instead of a locked/teaser view.
  if (!hasAccess) {
    redirect("/taller-virtual");
  }

  const documents = await listWorkshopDocumentsBySlug(slug);

  return (
    <>
      <JsonLd
        data={buildBreadcrumbSchema([
          { name: "Inicio", url: "/" },
          { name: "Talleres", url: "/taller-virtual" },
          { name: workshop.title, url: `/taller-virtual/${slug}` },
        ])}
      />
      <main>
        <WorkshopLanding workshop={workshop} documents={documents} />
      </main>
      <Footer />
    </>
  );
};

export default WorkshopDetailPage;
