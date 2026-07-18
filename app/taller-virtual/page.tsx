import type { Metadata } from "next";
import WorkshopsListing from "../components/home/WorkshopsListing";
import Footer from "../components/home/Footer";
import { isGoogleAuthEnabled } from "@/auth";
import { getWorkshopsFromDb } from "@/lib/workshops-db";
import { getPlanFromDb } from "@/lib/plans-from-db";
import { getServerUserCountry } from "@/lib/geo/user-country";
import type { Plan } from "@/lib/plans";

export const metadata: Metadata = {
  title: "Talleres Virtuales | Dayana Beltrán PNL",
  description:
    "Talleres virtuales de transformación con Dayana Beltrán. Próxima edición en preparación; consulta por WhatsApp para avisarte de fechas, terapias o cursos en vivo.",
};

// Reads geo headers per request (payment provider by country).
export const dynamic = "force-dynamic";

const WorkshopsPage = async () => {
  const [workshops, userCountry] = await Promise.all([
    getWorkshopsFromDb(),
    getServerUserCountry(),
  ]);

  // Plan per open workshop (usually one) so the card can carry the real
  // payment button instead of a navigation link.
  const openProductIds = [
    ...new Set(
      workshops
        .filter((w) => w.status === "open" && w.productId)
        .map((w) => w.productId as string)
    ),
  ];
  const planEntries = await Promise.all(
    openProductIds.map(async (id) => [id, await getPlanFromDb(id)] as const)
  );
  const plans: Record<string, Plan> = {};
  for (const [id, plan] of planEntries) {
    if (plan) plans[id] = plan;
  }

  return (
    <>
      <main>
        <WorkshopsListing
          workshops={workshops}
          plans={plans}
          userCountry={userCountry}
          googleEnabled={isGoogleAuthEnabled()}
        />
      </main>
      <Footer />
    </>
  );
};

export default WorkshopsPage;
