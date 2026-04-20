import HomeHero from "./components/home/HomeHero";
import ServicesSection from "./components/home/ServicesSection";
import TestimonialsSection from "./components/home/TestimonialsSection";
import ContactSection from "./components/home/ContactSection";
import ScrollProgress from "./components/ui/ScrollProgress";
import FloatingWhatsApp from "./components/ui/FloatingWhatsApp";

const Home = () => {
  return (
    <>
      <ScrollProgress />
      <main>
        <HomeHero />
        <TestimonialsSection />
        <ServicesSection />
        <ContactSection />
      </main>
      <FloatingWhatsApp />
    </>
  );
};

export default Home;
