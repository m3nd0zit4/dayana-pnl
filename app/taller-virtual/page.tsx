import type { Metadata } from "next";
import WorkshopLanding from "../components/home/WorkshopLanding";
import Footer from "../components/home/Footer";
import FloatingWhatsApp from "../components/ui/FloatingWhatsApp";

export const metadata: Metadata = {
  title: "Taller Virtual — Saca Tu Mejor Versión | Dayana Beltrán PNL",
  description:
    "Para personas que se sabotean o repiten patrones: un día intensivo de PNL para clarificar metas, reprogramar creencias y alinear tu vida. Virtual, sábado 16 de mayo, jornada completa con Dayana Beltrán.",
};

const WorkshopPage = () => {
  return (
    <>
      <main>
        <WorkshopLanding />
      </main>
      <Footer />
      <FloatingWhatsApp />
    </>
  );
};

export default WorkshopPage;
