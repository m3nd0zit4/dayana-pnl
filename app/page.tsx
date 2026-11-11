import type { Metadata } from "next";

import CallSalesPage from "@/app/components/llamada/CallSalesPage";
import { BRAND } from "@/lib/contact";

const title = `${BRAND.name} | Sana lo que te frena y construye lo tuyo`;
const description =
  "Sesiones 1 a 1 con Dayana Beltrán, Maestra en Programación Neurolingüística: primero sanas lo que te frena, después creces con tu negocio, tu marca personal y tu contenido. Agenda tu sesión gratis.";

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical: "/" },
  openGraph: { url: "/", type: "website", title, description },
};

// Lee el país de quien visita, los ajustes del embudo y el evento abierto en cada pedido.
export const dynamic = "force-dynamic";

/**
 * La portada ES la página de venta de la sesión 1 a 1 gratis (dueña, 10-nov:
 * «estructura todo» alrededor de la llamada). Una sola acción: agendar; la
 * venta se cierra en la llamada. La portada anterior (la escena del hero,
 * «Cómo funciona», testimonios, servicios y el formulario de contacto) sigue
 * en `app/components/home/` por si se quiere recuperar algo.
 */
const Home = () => <CallSalesPage home />;

export default Home;
