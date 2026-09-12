import type { Metadata } from "next";
import Hero from "./components/home/Hero";
import ServicesTeaser from "./components/home/ServicesTeaser";
import TestimonialsSection from "./components/home/TestimonialsSection";
import ContactSection from "./components/home/ContactSection";
import Footer from "./components/home/Footer";
import FloatingWhatsApp from "./components/ui/FloatingWhatsApp";
import { getVisiblePublicPlans } from "@/lib/pricing/public-plans";
import { SITE_TITLE, SITE_DESCRIPTION } from "@/lib/seo/site-meta";

export const metadata: Metadata = {
  title: SITE_TITLE,
  description: SITE_DESCRIPTION,
  alternates: { canonical: "/" },
  openGraph: { url: "/", type: "website" },
};

const Home = async () => {
  const { therapyPlans, coursePlan, userCountry, isColombia } =
    await getVisiblePublicPlans();

  const fromUsd =
    therapyPlans.length > 0
      ? Math.min(...therapyPlans.map((p) => p.amountUsd))
      : null;
  const copValues = therapyPlans
    .map((p) => p.amountCop)
    .filter((v): v is number => v != null);
  const fromCop = copValues.length > 0 ? Math.min(...copValues) : null;

  return (
    <>
      <main>
        <Hero />
        {/* Aquí vivía «Al punto donde se instaló», el bloque del método.
            Se retiró de la portada por decisión de producto: el mismo
            argumento sigue contándose en el resultado del cuestionario
            (`/terapias/resultado/<token>`), que es donde alguien se lo está
            preguntando de verdad. `METHOD_STEPS` se queda en
            `lib/diagnostico/profiles.ts` porque esa página lo usa.

            Aquí llegó a haber también una invitación al cuestionario, y se
            quitó antes: pedirle a alguien que se autodiagnostique antes de
            saber quién eres es cobrar la entrada antes de enseñar la casa. */}
        <ContactSection userCountry={userCountry} />
        <TestimonialsSection />
        <ServicesTeaser
          fromUsd={fromUsd}
          fromCop={fromCop}
          isColombia={isColombia}
          courseUsd={coursePlan?.amountUsd ?? null}
          courseCop={coursePlan?.amountCop ?? null}
        />
      </main>
      <Footer />
      <FloatingWhatsApp />
    </>
  );
};

export default Home;
