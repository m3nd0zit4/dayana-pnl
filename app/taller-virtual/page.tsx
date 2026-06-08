import type { Metadata } from "next";
import WorkshopsListing from "../components/home/WorkshopsListing";
import Footer from "../components/home/Footer";
import FloatingWhatsApp from "../components/ui/FloatingWhatsApp";
import { getWorkshopsFromDb } from "@/lib/workshops-db";

export const metadata: Metadata = {
  title: "Talleres Virtuales | Dayana Beltrán PNL",
  description:
    "Talleres virtuales de transformación con Dayana Beltrán. Próxima edición en preparación; consulta por WhatsApp para avisarte de fechas, terapias o cursos en vivo.",
};

const WorkshopsPage = async () => {
  const workshops = await getWorkshopsFromDb();

  return (
    <>
      <main>
        <WorkshopsListing workshops={workshops} />
      </main>
      <Footer />
      <FloatingWhatsApp />
    </>
  );
};

export default WorkshopsPage;
