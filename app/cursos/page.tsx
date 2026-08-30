import type { Metadata } from "next";
import Link from "next/link";

import Footer from "../components/home/Footer";
import FloatingWhatsApp from "../components/ui/FloatingWhatsApp";
import JsonLd from "../components/seo/JsonLd";
import CourseGrid from "../components/cursos/CourseGrid";
import RevealScope from "../components/common/RevealScope";
import SplitReveal from "../components/ui/SplitReveal";
import MembershipPicker from "../components/cursos/MembershipPicker";
import { getCourseCatalog } from "@/lib/courses/catalog";
import { BRAND } from "@/lib/contact";
import { buildBreadcrumbSchema } from "@/lib/seo/schema";
import { getSiteUrl } from "@/lib/site-url";
import { isGoogleAuthEnabled } from "@/auth";

export const dynamic = "force-dynamic";

const title = `Cursos de PNL en vivo | ${BRAND.name}`;
const description =
  "Una mensualidad abre toda la biblioteca: fundamentos, creencias limitantes, hipnosis, niveles de conciencia, lenguaje, emociones y pareja. Clases en vivo por Google Meet con Dayana Beltrán.";

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical: "/cursos" },
  openGraph: { title, description, url: "/cursos", type: "website" },
};

const CursosPage = async () => {
  const { courses, membership, annual, userCountry, isColombia } =
    await getCourseCatalog();
  const siteUrl = getSiteUrl();

  return (
    <>
      <JsonLd
        data={buildBreadcrumbSchema([
          { name: "Inicio", url: "/" },
          { name: "Cursos", url: "/cursos" },
        ])}
      />
      {courses.length > 0 && (
        <JsonLd
          data={{
            "@context": "https://schema.org",
            "@type": "ItemList",
            name: "Cursos de PNL",
            itemListElement: courses.map((c, i) => ({
              "@type": "ListItem",
              position: i + 1,
              url: `${siteUrl}/cursos/${c.slug}`,
              name: c.title,
            })),
          }}
        />
      )}

      <RevealScope className="bg-hero-paper text-ink" selector=".reveal">
        <main>
        {/* El precio va aquí y en ningún otro sitio de la página. Repetirlo por
            tarjeta sugeriría que los cursos se compran sueltos, que es
            justamente lo contrario del modelo. */}
        <section className="mx-auto w-full max-w-5xl px-5 pb-16 pt-28 sm:px-8 sm:pt-36">
          <p className="font-[font2] text-[10px] uppercase tracking-[0.3em] text-terracotta">
            Biblioteca de cursos
          </p>
          <SplitReveal
            text={`Una mensualidad.
Toda la biblioteca.`}
            className="mt-5 max-w-3xl font-[font2] text-4xl uppercase leading-[0.92] sm:text-6xl"
          />
          <p className="mt-6 max-w-xl font-[font1] text-lg leading-snug text-black/65">
            No eliges un curso: entras a todos. Mientras la mensualidad esté
            activa tienes acceso completo, y cuando se publica uno nuevo también
            lo tienes.
          </p>

        </section>

        <section className="mx-auto w-full max-w-5xl px-5 pb-20 sm:px-8">
          {courses.length === 0 ? (
            <p className="rounded-3xl border border-black/10 bg-white/50 p-8 font-[font1] text-lg text-black/60">
              Estamos publicando la biblioteca. Escríbenos y te avisamos en
              cuanto abra.
            </p>
          ) : (
            <CourseGrid courses={courses} />
          )}
        </section>

        <section className="reveal border-t border-black/10 bg-linen/40">
          <div className="mx-auto w-full max-w-3xl px-5 py-16 sm:px-8 sm:py-20">
            <h2 className="font-[font2] text-2xl uppercase leading-[0.95] sm:text-3xl">
              Qué incluye la mensualidad
            </h2>

            {membership ? (
              <>
                {membership.features.length > 0 && (
                  <ul className="mt-8 flex flex-col gap-3">
                    {membership.features.map((feature) => (
                      <li
                        key={feature}
                        className="flex gap-3 font-[font1] text-lg leading-snug text-black/75"
                      >
                        <span aria-hidden className="text-terracotta">
                          ·
                        </span>
                        {feature}
                      </li>
                    ))}
                  </ul>
                )}

                <div className="mt-10">
                  <MembershipPicker
                    monthly={membership}
                    annual={annual}
                    isColombia={isColombia}
                    userCountry={userCountry}
                    googleEnabled={isGoogleAuthEnabled()}
                    returnPath="/cursos"
                  />
                </div>
              </>
            ) : (
              <p className="mt-6 font-[font1] text-lg leading-relaxed text-black/70">
                Para tu país coordinamos el pago directamente. Escríbenos y lo
                resolvemos en un minuto.
              </p>
            )}

            <p className="mt-8 border-t border-black/10 pt-6">
              <Link
                href="/acceso"
                className="font-[font2] text-[11px] uppercase tracking-[0.24em] text-black/50 underline underline-offset-4 transition-colors hover:text-black"
              >
                Ya soy miembro · entrar al portal
              </Link>
            </p>
          </div>
        </section>

        <section className="reveal border-t border-black/10">
          <div className="mx-auto w-full max-w-3xl px-5 py-16 text-center sm:px-8 sm:py-20">
            <h2 className="font-[font2] text-2xl uppercase leading-[0.95] sm:text-3xl">
              ¿Buscabas acompañamiento personal?
            </h2>
            <p className="mx-auto mt-5 max-w-lg font-[font1] text-lg leading-relaxed text-black/70">
              Los cursos son para recorrer a tu ritmo. Si lo que necesitas es
              trabajar tu caso concreto con Dayana, eso son las sesiones 1:1.
            </p>
            <Link
              href="/terapias/empezar"
              className="mt-9 inline-block rounded-full border border-ink px-9 py-4 font-[font2] text-xs uppercase tracking-[0.18em] transition-colors hover:bg-ink hover:text-paper"
            >
              Ver terapias 1:1
            </Link>
          </div>
        </section>
        </main>
      </RevealScope>
      <Footer />
      <FloatingWhatsApp />
    </>
  );
};

export default CursosPage;
