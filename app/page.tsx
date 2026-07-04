import Hero from "./components/home/Hero";
import ServicesTeaser from "./components/home/ServicesTeaser";
import TestimonialsSection from "./components/home/TestimonialsSection";
import ContactSection from "./components/home/ContactSection";
import Footer from "./components/home/Footer";
import FloatingWhatsApp from "./components/ui/FloatingWhatsApp";
import { getVisiblePublicPlans } from "@/lib/pricing/public-plans";

const Home = async () => {
  const { therapyPlans, userCountry, isColombia } = await getVisiblePublicPlans();

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
        <ContactSection userCountry={userCountry} />
        <TestimonialsSection />
        <ServicesTeaser fromUsd={fromUsd} fromCop={fromCop} isColombia={isColombia} />
      </main>
      <Footer />
      <FloatingWhatsApp />
    </>
  );
};

export default Home;
