import type { Metadata } from "next";
import ComparisonSection from "../components/servicios/ComparisonSection";
import CourseAndCta from "../components/servicios/CourseAndCta";
import FaqSection from "../components/servicios/FaqSection";
import ServiciosHero from "../components/servicios/ServiciosHero";
import TherapyTiers from "../components/servicios/TherapyTiers";
import Footer from "../components/home/Footer";
import FloatingWhatsApp from "../components/ui/FloatingWhatsApp";
import JsonLd from "../components/seo/JsonLd";
import { getVisiblePublicPlans } from "@/lib/pricing/public-plans";
import { getPublicPlans } from "@/lib/plans-from-db";
import { FAQS } from "@/lib/content/servicios-faq";
import {
  buildServiceSchema,
  buildFaqPageSchema,
  buildBreadcrumbSchema,
} from "@/lib/seo/schema";

const title = "Servicios y Precios | Dayana Beltrán PNL";
const description =
  "Terapias 1:1 de reprogramación neurolingüística por Google Meet. Paquetes de 1 a 24 sesiones, precios en COP y USD, pago con MercadoPago o PayPal.";

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical: "/servicios" },
  openGraph: { title, description, url: "/servicios", type: "website" },
};

const ServiciosPage = async () => {
  const { therapyPlans, coursePlan, userCountry, isColombia } =
    await getVisiblePublicPlans();
  // Region-independent catalog (both currencies) for canonical structured data —
  // getVisiblePublicPlans() above is filtered per visitor and unsuitable for JSON-LD.
  const { therapyPlans: allTherapyPlans } = await getPublicPlans();

  return (
    <>
      <JsonLd data={buildServiceSchema(allTherapyPlans)} />
      <JsonLd data={buildFaqPageSchema(FAQS)} />
      <JsonLd
        data={buildBreadcrumbSchema([
          { name: "Inicio", url: "/" },
          { name: "Servicios", url: "/servicios" },
        ])}
      />
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
