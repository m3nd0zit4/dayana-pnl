import type { Metadata } from "next";
import Hero from "./components/home/Hero";
import MethodSection from "./components/home/MethodSection";
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
        {/* El orden es la decisión de esta página: primero se explica el
            método y quién es ella, y sólo después aparece el formulario.
            Aquí llegó a haber una invitación al cuestionario de terapias, y se
            quitó: pedirle a alguien que se autodiagnostique antes de saber
            quién eres es cobrar la entrada antes de enseñar la casa. El
            cuestionario vive en /terapias/empezar, a donde se llega por el
            menú y por el bloque de servicios de más abajo. */}
        <MethodSection />
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
