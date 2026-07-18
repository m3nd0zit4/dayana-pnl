import type { Metadata } from "next";
import { notFound } from "next/navigation";
import WorkshopLanding from "@/app/components/home/WorkshopLanding";
import WorkshopTeaser from "@/app/components/home/WorkshopTeaser";
import Footer from "@/app/components/home/Footer";
import { isGoogleAuthEnabled } from "@/auth";
import { getOpenWorkshopDetailBySlug } from "@/lib/workshops-db";
import { getMemberSession } from "@/lib/auth/member-session";
import { resolveSessionCheckoutContact } from "@/lib/crm/checkout-session-contact";
import { hasActiveWorkshopEnrollment } from "@/lib/crm/workshop-access";
import { getPlanFromDb } from "@/lib/plans-from-db";
import { getServerUserCountry } from "@/lib/geo/user-country";

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

  const [plan, userCountry] = workshop.productId
    ? await Promise.all([
        getPlanFromDb(workshop.productId),
        getServerUserCountry(),
      ])
    : [null, null];

  return (
    <>
      <main>
        {hasAccess ? (
          <WorkshopLanding workshop={workshop} />
        ) : (
          <WorkshopTeaser
            workshop={workshop}
            plan={plan}
            userCountry={userCountry}
            googleEnabled={isGoogleAuthEnabled()}
          />
        )}
      </main>
      <Footer />
    </>
  );
};

export default WorkshopDetailPage;
