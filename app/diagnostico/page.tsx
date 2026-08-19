import type { Metadata } from "next";

import DiagnosticoWizard from "../components/diagnostico/DiagnosticoWizard";
import { getServerUserCountry } from "@/lib/geo/user-country";

const title = "Diagnóstico gratuito | Dayana Beltrán PNL";
const description =
  "Dos minutos, ocho preguntas. Al final sabes qué patrón te está frenando y qué proceso necesitas para moverlo.";

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical: "/diagnostico" },
  openGraph: { title, description, url: "/diagnostico", type: "website" },
};

/**
 * El cuestionario no lleva la navegación de marketing a propósito.
 *
 * Un embudo de pasos compite consigo mismo si deja a la vista un menú, un
 * botón de "Servicios" y un WhatsApp flotante: cada uno es una salida. La
 * exclusión se hace en `app/providers.tsx`, igual que ya se hacía con
 * `/enlaces`.
 */
const DiagnosticoPage = async ({
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

export default DiagnosticoPage;
