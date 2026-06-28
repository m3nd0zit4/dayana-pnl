import Hero from "./components/home/Hero";
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
import { getServerUserCountry } from "@/lib/geo/user-country";

const Home = async () => {
  const [rate, userCountry] = await Promise.all([
    resolveUsdToCopRate().catch(() => getUsdToCopRateFromEnv()),
    getServerUserCountry().catch(() => null),
  ]);
  let therapyPlans = applyCopToPlans(THERAPY_PLANS, rate);
  let coursePlan = applyCopToPlan(COURSE_PLAN, rate);

  const isColombia = userCountry === "CO";

  try {
    const fromDb = await getPublicPlans();
    if (fromDb.therapyPlans.length > 0) therapyPlans = fromDb.therapyPlans;
    if (fromDb.coursePlan) coursePlan = fromDb.coursePlan;
  } catch {
    /* catálogo estático con COP según tasa */
  }

  // Hide plans that have no price for the user's region
  const visibleTherapyPlans = therapyPlans.filter((p) =>
    isColombia ? p.amountCop != null : p.amountUsd > 0
  );
  const visibleCoursePlan =
    coursePlan && (isColombia ? coursePlan.amountCop != null : coursePlan.amountUsd > 0)
      ? coursePlan
      : null;

  return (
    <>
      <main>
        <Hero />
        <ContactSection userCountry={userCountry} />
        <TestimonialsSection />
        <ServicesSection therapyPlans={visibleTherapyPlans} coursePlan={visibleCoursePlan} userCountry={userCountry} />
      </main>
      <Footer />
      <FloatingWhatsApp />
    </>
  );
};

export default Home;
