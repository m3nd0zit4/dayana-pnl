import type { Metadata } from "next";
import WorkshopsListing from "../components/home/WorkshopsListing";
import Footer from "../components/home/Footer";
import FloatingWhatsApp from "../components/ui/FloatingWhatsApp";

export const metadata: Metadata = {
  title: "Talleres Virtuales | Dayana Beltrán PNL",
  description:
    "Talleres virtuales de transformación con Dayana Beltrán. Revisa ediciones realizadas y consulta por WhatsApp para próximas fechas, terapias o cursos en vivo.",
};

const WorkshopsPage = () => {
  return (
    <>
      <main>
        <WorkshopsListing />
      </main>
      <Footer />
      <FloatingWhatsApp />
    </>
  );
};

export default WorkshopsPage;
