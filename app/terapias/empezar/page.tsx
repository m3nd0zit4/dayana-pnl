import type { Metadata } from "next";

import DiagnosticoWizard from "@/app/components/diagnostico/DiagnosticoWizard";
import { getServerUserCountry } from "@/lib/geo/user-country";

const title = "Empezar tu proceso | Dayana Beltrán PNL";
const description =
  "Doce preguntas, tres minutos. Al final sabes qué patrón te está frenando, qué proceso necesitas y cuál es tu siguiente paso.";

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical: "/terapias/empezar" },
  openGraph: { title, description, url: "/terapias/empezar", type: "website" },
};

/**
 * El cuestionario no lleva la navegación de marketing a propósito.
 *
 * Un embudo de pasos compite consigo mismo si deja a la vista un menú, un
 * botón de "Terapias" y un WhatsApp flotante: cada uno es una salida. La
 * exclusión se hace en `app/providers.tsx`, igual que ya se hacía con
 * `/enlaces`.
 */
const EmpezarPage = async ({
  searchParams,
}: {
  searchParams: Promise<{ ref?: string }>;
}) => {
  const [{ ref }, userCountry] = await Promise.all([
    searchParams,
    getServerUserCountry().catch(() => null),
  ]);

  return (
    <main className="min-h-[100svh] bg-hero-paper text-ink">
      <DiagnosticoWizard userCountry={userCountry} source={ref} />
    </main>
  );
};

export default EmpezarPage;
