import type { Metadata } from "next";
import Hero from "./components/home/Hero";
import CallSteps from "./components/home/CallSteps";
import ServicesTeaser from "./components/home/ServicesTeaser";
import TestimonialsSection from "./components/home/TestimonialsSection";
import ContactSection from "./components/home/ContactSection";
import Footer from "./components/home/Footer";
import FloatingWhatsApp from "./components/ui/FloatingWhatsApp";
import { getVisiblePublicPlans } from "@/lib/pricing/public-plans";
import { SITE_TITLE, SITE_DESCRIPTION } from "@/lib/seo/site-meta";

export const metadata: Metadata = {
  title: SITE_TITLE,
  description: SITE_DESCRIPTION,
  alternates: { canonical: "/" },
  openGraph: { url: "/", type: "website" },
};

const Home = async () => {
  const { therapyPlans, coursePlan, userCountry, isColombia } =
    await getVisiblePublicPlans();

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
        {/* La portada es un camino a UNA acción: «Agenda tu llamada gratis»
            (`/llamada`). El orden lo cuenta: el botón en la portada → qué va a
            pasar, en tres pasos → quienes ya lo vivieron → qué se trabaja →
            y, para quien prefiere no agendar, el formulario de siempre.
            Cada enlace a `/llamada` lleva su `?ref=` para que el CRM sepa qué
            puerta funcionó (inicio, inicio-pasos, inicio-servicios,
            inicio-contacto, contacto). */}
        <Hero />
        {/* Aquí vivía «Al punto donde se instaló», el bloque del método.
            Se retiró de la portada por decisión de producto: el mismo
            argumento sigue contándose en el resultado del cuestionario
            (`/terapias/resultado/<token>`), que es donde alguien se lo está
            preguntando de verdad. `METHOD_STEPS` se queda en
            `lib/diagnostico/profiles.ts` porque esa página lo usa.

            Aquí llegó a haber también una invitación al cuestionario, y se
            quitó antes: pedirle a alguien que se autodiagnostique antes de
            saber quién eres es cobrar la entrada antes de enseñar la casa.

            «Cómo funciona» no es ninguna de las dos cosas: no explica el
            método ni pide nada; dice qué pasa al tocar el botón. Ocupa el
            sitio (y la carcasa redondeada) que tenía el formulario, que es lo
            que recibe a la escena fijada del hero cuando termina. */}
        <CallSteps />
        <TestimonialsSection />
        <ServicesTeaser
          fromUsd={fromUsd}
          fromCop={fromCop}
          isColombia={isColombia}
          courseUsd={coursePlan?.amountUsd ?? null}
          courseCop={coursePlan?.amountCop ?? null}
        />
        {/* El formulario pasa al final, como camino secundario («¿Prefieres
            que te escribamos nosotros?»). Va DESPUÉS de ServicesTeaser, que
            sigue siendo la última sección apilada (`isLast`): el pin de
            TestimonialsSection depende de ese contrato y no se toca. */}
        <ContactSection userCountry={userCountry} />
      </main>
      <Footer />
      <FloatingWhatsApp />
    </>
  );
};

export default Home;
