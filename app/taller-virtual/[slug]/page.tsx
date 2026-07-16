import type { Metadata } from "next";
import { notFound } from "next/navigation";
import WorkshopLanding from "@/app/components/home/WorkshopLanding";
import WorkshopTeaser from "@/app/components/home/WorkshopTeaser";
import Footer from "@/app/components/home/Footer";
import FloatingWhatsApp from "@/app/components/ui/FloatingWhatsApp";
import { getOpenWorkshopDetailBySlug } from "@/lib/workshops-db";
import { getMemberSession } from "@/lib/auth/member-session";
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
  let hasMemberSession = false;
  if (workshop.productId) {
    const member = await getMemberSession();
    hasMemberSession = !!member;
    if (member) {
      hasAccess = await hasActiveWorkshopEnrollment(
        member.contact.id,
        workshop.productId
      );
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
            hasMemberSession={hasMemberSession}
          />
        )}
      </main>
      <Footer />
      <FloatingWhatsApp />
    </>
  );
};

export default WorkshopDetailPage;
