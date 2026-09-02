import type { Metadata } from "next";
import Link from "next/link";

import Footer from "../components/home/Footer";
import FloatingWhatsApp from "../components/ui/FloatingWhatsApp";
import JsonLd from "../components/seo/JsonLd";
import CourseGrid from "../components/cursos/CourseGrid";
import RevealScope from "../components/common/RevealScope";
import CoursesHero from "../components/cursos/CoursesHero";
import MembershipPicker from "../components/cursos/MembershipPicker";
import { getCourseCatalog } from "@/lib/courses/catalog";
import { getCoursesHero } from "@/lib/courses/hero";
import { getPortalViewer } from "@/lib/auth/portal-viewer";
import { BRAND } from "@/lib/contact";
import { buildBreadcrumbSchema } from "@/lib/seo/schema";
import { getSiteUrl } from "@/lib/site-url";
import { isGoogleAuthEnabled } from "@/auth";

export const dynamic = "force-dynamic";

const title = `Cursos de PNL en vivo | ${BRAND.name}`;
// Neutral respecto a cómo se paga. La versión anterior abría con «una
// mensualidad abre toda la biblioteca», que dejó de ser toda la verdad en
// cuanto un curso pudo comprarse suelto — y esto es lo que se lee en Google,
// donde no hay forma de matizarlo después.
const description =
  "Fundamentos, creencias limitantes, hipnosis, niveles de conciencia, lenguaje, emociones y pareja. Cursos de PNL con Dayana Beltrán: compra uno suelto o entra a la biblioteca completa con la membresía.";

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical: "/cursos" },
  openGraph: { title, description, url: "/cursos", type: "website" },
};

const CursosPage = async () => {
  // La sesión se resuelve primero porque el catálogo se anota con ella. No es
  // un gate: sin nadie dentro `getCourseCatalog(null)` devuelve exactamente la
  // misma página pública que antes.
  const viewer = await getPortalViewer().catch(() => null);
  const [{ courses, membership, annual, hasStandaloneSales, userCountry, isColombia }, hero] =
    await Promise.all([getCourseCatalog(viewer), getCoursesHero()]);
  const siteUrl = getSiteUrl();
  const lessonCount = courses.reduce((n, c) => n + c.lessonCount, 0);

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
        <CoursesHero
          hero={hero}
          courseCount={courses.length}
          lessonCount={lessonCount}
          hasStandaloneSales={hasStandaloneSales}
        />

        <section className="mx-auto w-full max-w-5xl px-5 pb-20 pt-16 sm:px-8">
          {courses.length === 0 ? (
            <p className="rounded-3xl border border-black/10 bg-white/50 p-8 font-[font1] text-lg text-black/60">
              Estamos publicando la biblioteca. Escríbenos y te avisamos en
              cuanto abra.
            </p>
          ) : (
            <CourseGrid courses={courses} isColombia={isColombia} />
          )}
        </section>

        <section className="reveal border-t border-black/10 bg-linen/40">
          <div className="mx-auto w-full max-w-3xl px-5 py-16 sm:px-8 sm:py-20">
            <h2 className="font-[font2] text-2xl uppercase leading-[0.95] sm:text-3xl">
              {hasStandaloneSales
                ? "O entra a todos con la membresía"
                : "Qué incluye la mensualidad"}
            </h2>
            {hasStandaloneSales && (
              // Con venta suelta el bloque deja de ser «esto es lo que hay» y
              // pasa a ser una comparación: arriba está el precio de un curso,
              // aquí el de todos. Sin esta frase las dos cifras se leen como
              // dos ofertas sueltas y no como una decisión.
              <p className="mt-4 font-[font1] text-lg leading-snug text-black/65">
                Un curso suelto es tuyo para siempre. La membresía abre los{" "}
                {courses.length} mientras esté al día, y también los que se
                publiquen después.
              </p>
            )}

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
