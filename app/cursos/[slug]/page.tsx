import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import Footer from "@/app/components/home/Footer";
import RevealScope from "@/app/components/common/RevealScope";
import FloatingWhatsApp from "@/app/components/ui/FloatingWhatsApp";
import JsonLd from "@/app/components/seo/JsonLd";
import MembershipPicker from "@/app/components/cursos/MembershipPicker";
import PortalCheckoutCta from "@/app/components/payments/PortalCheckoutCta";
import { getCourseDetail, listCourseSlugs } from "@/lib/courses/catalog";
import { getPortalViewer } from "@/lib/auth/portal-viewer";
import { formatCop, formatUsd } from "@/lib/plans";
import { BRAND } from "@/lib/contact";
import { buildBreadcrumbSchema } from "@/lib/seo/schema";
import { getSiteUrl } from "@/lib/site-url";
import { isGoogleAuthEnabled } from "@/auth";

export const dynamic = "force-dynamic";

export async function generateStaticParams() {
  return (await listCourseSlugs().catch(() => [])).map((slug) => ({ slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const detail = await getCourseDetail(slug).catch(() => null);
  if (!detail) return { title: `Curso | ${BRAND.name}`, robots: { index: false } };

  const title = `${detail.course.title} | ${BRAND.name}`;
  const description =
    detail.course.description ??
    `Curso de PNL en vivo con Dayana Beltrán. ${detail.course.sessionsLabel}.`;

  return {
    title,
    description,
    alternates: { canonical: `/cursos/${slug}` },
    openGraph: { title, description, url: `/cursos/${slug}`, type: "website" },
  };
}

const CursoDetallePage = async ({
  params,
}: {
  params: Promise<{ slug: string }>;
}) => {
  const { slug } = await params;
  const viewer = await getPortalViewer().catch(() => null);
  const detail = await getCourseDetail(slug, viewer);
  // Un curso inactivo o inexistente responde igual: 404. La biblioteca tiene
  // cursos a medio grabar y una página a medias vende peor que ninguna.
  if (!detail) notFound();

  const {
    course,
    modules,
    membership,
    annual,
    userCountry,
    isColombia,
    siblingCount,
  } = detail;
  const siteUrl = getSiteUrl();

  return (
    <>
      <JsonLd
        data={buildBreadcrumbSchema([
          { name: "Inicio", url: "/" },
          { name: "Cursos", url: "/cursos" },
          { name: course.title, url: `/cursos/${slug}` },
        ])}
      />
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "Course",
          name: course.title,
          description: course.description ?? undefined,
          url: `${siteUrl}/cursos/${slug}`,
          inLanguage: "es",
          provider: {
            "@type": "Person",
            name: BRAND.name,
            url: siteUrl,
          },
        }}
      />

      <RevealScope className="bg-hero-paper text-ink" selector=".reveal">
        <main>
        <section className="mx-auto w-full max-w-3xl px-5 pb-14 pt-28 sm:px-8 sm:pt-36">
          <Link
            href="/cursos"
            className="font-[font2] text-[11px] uppercase tracking-[0.24em] text-black/45 transition-colors hover:text-black"
          >
            ← Todos los cursos
          </Link>

          <p className="mt-8 font-mono text-[11px] uppercase tracking-[0.24em] text-terracotta">
            {course.sessionsLabel}
          </p>
          <h1 className="mt-5 font-[font2] text-4xl uppercase leading-[0.92] sm:text-6xl">
            {course.title}
          </h1>
          {course.description && (
            <p className="mt-6 max-w-xl font-[font1] text-lg leading-relaxed text-black/70 sm:text-xl">
              {course.description}
            </p>
          )}
        </section>

        {modules.length > 0 && (
          <section className="reveal border-t border-black/10 bg-linen/40">
            <div className="mx-auto w-full max-w-3xl px-5 py-16 sm:px-8 sm:py-20">
              <h2 className="font-[font2] text-2xl uppercase leading-[0.95] sm:text-3xl">
                El temario
              </h2>
              {/* Se listan módulos, no lecciones. El temario dice qué vas a
                  aprender; el índice completo de 50 lecciones sólo abruma y
                  además regala el contenido de un curso que aún no compró. */}
              <ol className="mt-10 flex flex-col gap-9">
                {modules.map((module, i) => (
                  <li key={module.id} className="reveal flex gap-5">
                    <span className="shrink-0 font-[font2] text-sm text-terracotta">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <div>
                      <h3 className="font-[font2] text-lg uppercase leading-tight">
                        {module.title}
                      </h3>
                      {module.lessonCount > 0 && (
                        <p className="mt-1 font-mono text-[11px] uppercase tracking-[0.2em] text-black/40">
                          {module.lessonCount}{" "}
                          {module.lessonCount === 1 ? "lección" : "lecciones"}
                        </p>
                      )}
                      {module.bodyMd && (
                        <p className="mt-3 font-[font1] text-base leading-relaxed text-black/65">
                          {firstParagraph(module.bodyMd)}
                        </p>
                      )}
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          </section>
        )}

        {/* Ya lo tiene: nada que vender. Enseñar el precio de algo que esta
            persona ya pagó es la peor pantalla posible, así que la sección de
            compra se sustituye entera por la puerta de entrada. */}
        {course.access?.hasAccess ? (
          <section className="reveal border-t border-black/10">
            <div className="mx-auto w-full max-w-3xl px-5 py-16 sm:px-8 sm:py-20">
              <h2 className="font-[font2] text-2xl uppercase leading-[0.95] sm:text-3xl">
                Ya tienes este curso
              </h2>
              {/* Sin total, igual que en la tarjeta: `sessionsLabel` está
                  escrito a mano en curso.json y se desfasa del recuento real,
                  así que la cabecera decía «45 lecciones» y esto «de 57». */}
              <p className="mt-5 font-[font1] text-lg leading-relaxed text-black/75">
                {course.access.completedLessons > 0
                  ? `Llevas ${course.access.completedLessons} ${
                      course.access.completedLessons === 1
                        ? "lección completada"
                        : "lecciones completadas"
                    }.`
                  : "Todavía no has empezado. Es un buen momento."}
              </p>
              <Link
                href={
                  course.access.nextClassId
                    ? `/miembros/curso/${slug}?c=${course.access.nextClassId}`
                    : `/miembros/curso/${slug}`
                }
                className="mt-9 inline-block rounded-full border border-ink px-9 py-4 font-[font2] text-xs uppercase tracking-[0.18em] transition-colors hover:bg-ink hover:text-paper"
              >
                {course.access.completedLessons > 0 ? "Continuar" : "Empezar el curso"}
              </Link>
            </div>
          </section>
        ) : (
        <section className="reveal border-t border-black/10">
          <div className="mx-auto w-full max-w-3xl px-5 py-16 sm:px-8 sm:py-20">
            <h2 className="font-[font2] text-2xl uppercase leading-[0.95] sm:text-3xl">
              {course.plan ? "Cómo entrar" : "Este curso no se compra suelto"}
            </h2>
            <p className="mt-5 font-[font1] text-lg leading-relaxed text-black/75">
              {course.plan ? (
                <>
                  Puedes comprarlo solo —es tuyo para siempre— o entrar con la
                  membresía
                  {siblingCount > 0
                    ? ` y llevarte también los otros ${siblingCount} cursos`
                    : " y tener la biblioteca completa"}
                  .
                </>
              ) : siblingCount > 0 ? (
                <>
                  Entra con la mensualidad, junto a los otros {siblingCount}{" "}
                  cursos de la biblioteca. Pagas una vez al mes y los tienes
                  todos, incluidos los que se publiquen después.
                </>
              ) : (
                <>
                  Entra con la mensualidad de la biblioteca. Pagas una vez al mes
                  y tienes acceso completo, incluidos los cursos que se publiquen
                  después.
                </>
              )}
            </p>

            {course.plan && (
              <div className="mt-9 rounded-3xl border border-ink/25 bg-white/70 p-6 sm:p-8">
                <h3 className="font-[font2] text-xl uppercase leading-tight">
                  Sólo este curso
                </h3>
                <p className="mt-4 flex items-baseline gap-3">
                  <span className="font-[font2] text-4xl leading-none">
                    {isColombia && course.plan.amountCop != null
                      ? formatCop(course.plan.amountCop)
                      : formatUsd(course.plan.amountUsd)}
                  </span>
                  <span className="font-mono text-[11px] uppercase tracking-[0.2em] text-black/45">
                    pago único
                  </span>
                </p>
                <p className="mt-4 font-[font1] text-base leading-relaxed text-black/65">
                  Sin renovación y sin fecha de caducidad: lo compras una vez y
                  queda en tu cuenta.
                </p>
                {/* El mismo checkout que la membresía: crea la cuenta antes de
                    cobrar, porque el curso se entrega dentro del portal y sin
                    cuenta no hay a quién dárselo. */}
                <PortalCheckoutCta
                  plan={course.plan}
                  userCountry={userCountry}
                  isDark={false}
                  googleEnabled={isGoogleAuthEnabled()}
                  autopayReturnPath={`/cursos/${slug}`}
                />
              </div>
            )}

            {membership ? (
              <div className="mt-9 rounded-3xl border border-black/12 bg-white/70 p-6 sm:p-8">
                <h3 className="font-[font2] text-xl uppercase leading-tight">
                  {course.plan ? `O todo: ${membership.title}` : membership.title}
                </h3>
                {membership.features.length > 0 && (
                  <ul className="mt-6 flex flex-col gap-2.5 border-t border-black/10 pt-6">
                    {membership.features.map((feature) => (
                      <li
                        key={feature}
                        className="flex gap-3 font-[font1] text-base leading-snug text-black/70"
                      >
                        <span aria-hidden className="text-terracotta">
                          ·
                        </span>
                        {feature}
                      </li>
                    ))}
                  </ul>
                )}

                <div className="mt-8">
                  <MembershipPicker
                    monthly={membership}
                    annual={annual}
                    isColombia={isColombia}
                    userCountry={userCountry}
                    googleEnabled={isGoogleAuthEnabled()}
                    returnPath={`/cursos/${slug}`}
                  />
                </div>

                <p className="mt-6 border-t border-black/10 pt-5 font-[font1] text-sm leading-relaxed text-black/55">
                  Se renueva cada mes y la cancelas cuando quieras. Al cancelar
                  conservas el acceso hasta el final del mes que ya pagaste.
                </p>
              </div>
            ) : (
              <div className="mt-9 rounded-3xl border border-black/12 bg-white/70 p-6 sm:p-8">
                <p className="font-[font1] text-lg leading-relaxed text-black/75">
                  Para tu país coordinamos el pago directamente. Escríbenos y lo
                  resolvemos en un minuto.
                </p>
              </div>
            )}

            <div className="mt-10 flex flex-col gap-4 border-t border-black/10 pt-8">
              <Link
                href="/acceso"
                className="font-[font2] text-[11px] uppercase tracking-[0.24em] text-black/60 underline underline-offset-4 transition-colors hover:text-black"
              >
                Ya soy miembro · entrar al portal
              </Link>
              <Link
                href="/cursos"
                className="font-[font2] text-[11px] uppercase tracking-[0.24em] text-black/40 underline underline-offset-4 transition-colors hover:text-black"
              >
                Ver los demás cursos
              </Link>
            </div>
          </div>
        </section>
        )}
        </main>
      </RevealScope>
      <Footer />
      <FloatingWhatsApp />
    </>
  );
};

/**
 * El primer párrafo del cuerpo del módulo, sin marcas de Markdown.
 *
 * `bodyMd` es texto de estudio completo —listas, encabezados— y renderizarlo
 * entero convertiría el temario en el curso. Aquí sólo hace falta la frase que
 * dice de qué va el módulo.
 */
function firstParagraph(bodyMd: string): string {
  const paragraph =
    bodyMd
      .split(/\n\s*\n/)
      .map((block) => block.trim())
      .find((block) => block.length > 0 && !block.startsWith("#")) ?? "";

  return paragraph
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\*(.+?)\*/g, "$1")
    .replace(/`(.+?)`/g, "$1")
    .replace(/\[(.+?)\]\(.+?\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

export default CursoDetallePage;
