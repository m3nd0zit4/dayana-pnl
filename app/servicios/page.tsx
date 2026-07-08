import type { Metadata } from "next";
import ComparisonSection from "../components/servicios/ComparisonSection";
import CourseAndCta from "../components/servicios/CourseAndCta";
import FaqSection from "../components/servicios/FaqSection";
import ServiciosHero from "../components/servicios/ServiciosHero";
import TherapyTiers from "../components/servicios/TherapyTiers";
import Footer from "../components/home/Footer";
import FloatingWhatsApp from "../components/ui/FloatingWhatsApp";
import { getVisiblePublicPlans } from "@/lib/pricing/public-plans";

export const metadata: Metadata = {
  title: "Servicios y Precios | Dayana Beltrán PNL",
  description:
    "Terapias 1:1 de reprogramación neurolingüística por Google Meet. Paquetes de 1 a 24 sesiones, precios en COP y USD, pago con MercadoPago o PayPal.",
};

const ServiciosPage = async () => {
  const { therapyPlans, coursePlan, userCountry, isColombia } =
    await getVisiblePublicPlans();

  return (
    <>
      <main>
        <ServiciosHero isColombia={isColombia} />
        <TherapyTiers therapyPlans={therapyPlans} userCountry={userCountry} />
        <ComparisonSection therapyPlans={therapyPlans} isColombia={isColombia} />
        <FaqSection />
        <CourseAndCta
          coursePlan={coursePlan}
          isColombia={isColombia}
          userCountry={userCountry}
        />
      </main>
      <Footer />
      <FloatingWhatsApp />
    </>
  );
};

export default ServiciosPage;
