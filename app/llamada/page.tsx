import type { Metadata } from "next";

import CallSalesPage from "@/app/components/llamada/CallSalesPage";
import { BRAND } from "@/lib/contact";

const title = `Sesión 1 a 1 gratis con ${BRAND.name}`;
const description =
  "De sentirte sin energía a construir la vida y el negocio que te dé propósito. Agenda una sesión 1 a 1 gratis con Dayana Beltrán: ella te llama por WhatsApp.";

/**
 * A donde apuntan los anuncios y los enlaces de redes. Es la misma página que
 * la portada; la dirección propia existe para medir (`?ref=`, campañas) y para
 * que los anuncios no cambien si la portada cambia. Canónica: la portada.
 */
export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    locale: "es_ES",
    url: "/",
    siteName: BRAND.shortName,
    title,
    description,
    images: [{ url: "/og-image.png", width: 1083, height: 568, alt: `${BRAND.name}, coach` }],
  },
  twitter: { card: "summary_large_image", title, description, images: ["/og-image.png"] },
};

// Lee el país de quien visita, los ajustes del embudo y el evento abierto en cada pedido.
export const dynamic = "force-dynamic";

const LlamadaPage = () => <CallSalesPage />;

export default LlamadaPage;
