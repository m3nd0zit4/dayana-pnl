import type { Metadata } from "next";
import { notFound } from "next/navigation";
import WorkshopLanding from "@/app/components/home/WorkshopLanding";
import Footer from "@/app/components/home/Footer";
import FloatingWhatsApp from "@/app/components/ui/FloatingWhatsApp";
import { getOpenWorkshopDetailBySlug } from "@/lib/workshops-db";

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

  return (
    <>
      <main>
        <WorkshopLanding workshop={workshop} />
      </main>
      <Footer />
      <FloatingWhatsApp />
    </>
  );
};

export default WorkshopDetailPage;
