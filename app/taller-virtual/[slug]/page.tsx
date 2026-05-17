import type { Metadata } from "next";
import { notFound } from "next/navigation";
import WorkshopLanding from "../../components/home/WorkshopLanding";
import Footer from "../../components/home/Footer";
import FloatingWhatsApp from "../../components/ui/FloatingWhatsApp";
import {
  WORKSHOP_SLUGS,
  getWorkshopBySlug,
} from "../../../lib/workshops";

type PageProps = {
  params: Promise<{ slug: string }>;
};

export function generateStaticParams() {
  return WORKSHOP_SLUGS.map((slug) => ({ slug }));
}

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const workshop = getWorkshopBySlug(slug);
  if (!workshop) return { title: "Taller no encontrado" };
  return {
    title: workshop.metadata.title,
    description: workshop.metadata.description,
  };
}

const WorkshopDetailPage = async ({ params }: PageProps) => {
  const { slug } = await params;
  const workshop = getWorkshopBySlug(slug);
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
