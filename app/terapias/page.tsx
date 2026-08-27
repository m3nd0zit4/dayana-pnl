import type { Metadata } from "next";
import ComparisonSection from "../components/servicios/ComparisonSection";
import TerapiasCta from "../components/servicios/TerapiasCta";
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

const title = "Terapias 1:1 de PNL | Dayana Beltrán PNL";
const description =
  "Sesiones privadas 1:1 de reprogramación neurolingüística por Google Meet. Paquetes de 1 a 24 sesiones, precios en COP y USD, pago con Mercado Pago o PayPal.";

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical: "/terapias" },
  openGraph: { title, description, url: "/terapias", type: "website" },
};

/**
 * Esta página vende **una** cosa: acompañamiento 1:1.
 *
 * Antes vivía en `/servicios` y vendía también la mensualidad del curso, con
 * dos lógicas de compra opuestas —un paquete que se paga una vez y una
 * suscripción que se renueva— compitiendo en la misma pantalla. La biblioteca
 * se mudó a `/cursos`; `/servicios` redirige aquí de forma permanente
 * (`next.config.ts`), porque está indexado y repartido por WhatsApp.
 */
const TerapiasPage = async () => {
  const { therapyPlans, userCountry, isColombia } =
    await getVisiblePublicPlans();
  // Catálogo sin filtrar por región (ambas monedas) para el structured data —
  // getVisiblePublicPlans() está filtrado por visitante y no sirve para JSON-LD.
  const { therapyPlans: allTherapyPlans } = await getPublicPlans();

  return (
    <>
      <JsonLd data={buildServiceSchema(allTherapyPlans)} />
      <JsonLd data={buildFaqPageSchema(FAQS)} />
      <JsonLd
        data={buildBreadcrumbSchema([
          { name: "Inicio", url: "/" },
          { name: "Terapias", url: "/terapias" },
        ])}
      />
      <main>
        <ServiciosHero isColombia={isColombia} />
        <TherapyTiers therapyPlans={therapyPlans} userCountry={userCountry} />
        <ComparisonSection therapyPlans={therapyPlans} isColombia={isColombia} />
        <FaqSection />
        <TerapiasCta />
      </main>
      <Footer />
      <FloatingWhatsApp />
    </>
  );
};

export default TerapiasPage;
