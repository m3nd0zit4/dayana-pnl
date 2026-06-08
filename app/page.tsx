import HomeHero from "./components/home/HomeHero";
import ServicesSection from "./components/home/ServicesSection";
import TestimonialsSection from "./components/home/TestimonialsSection";
import ContactSection from "./components/home/ContactSection";
import Footer from "./components/home/Footer";
import FloatingWhatsApp from "./components/ui/FloatingWhatsApp";
import { getPublicPlans } from "@/lib/plans-from-db";
import { COURSE_PLAN, THERAPY_PLANS } from "@/lib/plans";

const Home = async () => {
  let therapyPlans = THERAPY_PLANS;
  let coursePlan = COURSE_PLAN;

  try {
    const fromDb = await getPublicPlans();
    if (fromDb.therapyPlans.length > 0) therapyPlans = fromDb.therapyPlans;
    if (fromDb.coursePlan) coursePlan = fromDb.coursePlan;
  } catch {
    /* fallback estático */
  }

  return (
    <>
      <main>
        <HomeHero />
        <TestimonialsSection />
        <ServicesSection therapyPlans={therapyPlans} coursePlan={coursePlan} />
        <ContactSection />
      </main>
      <Footer />
      <FloatingWhatsApp />
    </>
  );
};

export default Home;
