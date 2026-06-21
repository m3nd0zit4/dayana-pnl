import HomeHero from "./components/home/HomeHero";
import ServicesSection from "./components/home/ServicesSection";
import TestimonialsSection from "./components/home/TestimonialsSection";
import ContactSection from "./components/home/ContactSection";
import Footer from "./components/home/Footer";
import FloatingWhatsApp from "./components/ui/FloatingWhatsApp";
import { getPublicPlans } from "@/lib/plans-from-db";
import { resolveUsdToCopRate } from "@/lib/crm/site-settings";
import {
  applyCopToPlan,
  applyCopToPlans,
  getUsdToCopRateFromEnv,
} from "@/lib/pricing/usd-to-cop";
import { COURSE_PLAN, THERAPY_PLANS } from "@/lib/plans";

const Home = async () => {
  const rate = await resolveUsdToCopRate().catch(() => getUsdToCopRateFromEnv());
  let therapyPlans = applyCopToPlans(THERAPY_PLANS, rate);
  let coursePlan = applyCopToPlan(COURSE_PLAN, rate);

  try {
    const fromDb = await getPublicPlans();
    if (fromDb.therapyPlans.length > 0) therapyPlans = fromDb.therapyPlans;
    if (fromDb.coursePlan) coursePlan = fromDb.coursePlan;
  } catch {
    /* catálogo estático con COP según tasa */
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
