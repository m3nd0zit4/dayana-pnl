import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { CalendarDays, Gift, Laptop } from "lucide-react";
import LocalScheduleChips from "@/app/components/datetime/LocalScheduleChips";
import WorkshopRegisterForm from "@/app/components/workshops/WorkshopRegisterForm";
import { BRAND, buildWhatsAppUrl } from "@/lib/contact";
import { currentSlugForPrevious } from "@/lib/crm/workshop-editions";
import { loadRegistrationEdition } from "@/lib/crm/workshop-registration";
import { registrationWhen, workshopRegistrationPath } from "@/lib/crm/workshop-registration-rules";
import { getServerUserCountry } from "@/lib/geo/user-country";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
};

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const edition = await loadRegistrationEdition(slug).catch(() => null);
  const title = edition ? `Regístrate: ${edition.title} | ${BRAND.name}` : `Talleres | ${BRAND.name}`;
  const description = edition?.cardSummary?.trim() || "Regístrate gratis y te escribimos por WhatsApp para separar tu cupo o agendar una llamada con Dayana.";
  // Un formulario: la página que se indexa es la del taller.
  return { title, description, robots: { index: false }, ...(edition ? { alternates: { canonical: `/taller-virtual/${slug}` } } : {}) };
}

const chip =
  "inline-flex items-center gap-2 rounded-full border border-black/10 bg-white/55 px-3.5 py-2 font-[font1] text-sm text-black/75 shadow-[inset_0_1px_0_rgba(255,255,255,0.7)] backdrop-blur-md";

/**
 * El registro de interés en el taller (dueña, 28-oct: «básicamente todo el
 * flujo viene desde la página de enlaces… la gente que oprime ahí en taller se
 * registra y se clasifica como interesada»). Llegan sobre todo de TikTok por el
 * botón «Taller» de `/enlaces`, en el navegador de la app: primero el
 * formulario, corto. Registrarse es gratis y no da acceso; después le escribe
 * la asistente por WhatsApp (separar el cupo o la llamada gratis con Dayana).
 *
 * Solo mientras las inscripciones están abiertas (la regla del botón): si no,
 * la página del taller dice qué pasó. Una dirección vieja lleva a la nueva.
 */
const WorkshopRegistrationPage = async ({ params, searchParams }: PageProps) => {
  const [{ slug }, sp] = await Promise.all([params, searchParams]);
  const edition = await loadRegistrationEdition(slug);
  if (!edition) {
    const renamed = await currentSlugForPrevious(slug);
    if (renamed) redirect(workshopRegistrationPath(renamed));
    notFound();
  }
  if (!edition.open) redirect(`/taller-virtual/${encodeURIComponent(edition.slug)}`);

  const userCountry = await getServerUserCountry();
  const rawRef = Array.isArray(sp.ref) ? sp.ref[0] : sp.ref;
  const refSource = rawRef && /^[a-z0-9_-]{1,40}$/i.test(rawRef) ? rawRef.toLowerCase() : null;
  const when = registrationWhen(edition);
  const summary = edition.cardSummary?.trim() || null;
  const whatsappHref = buildWhatsAppUrl(`Hola Dayana, me registré para el taller «${edition.title}» y quiero más información.`);

  return (
    <main className="relative min-h-[100dvh] overflow-x-hidden bg-[#f0ece4] text-black">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-[55vh] bg-[radial-gradient(ellipse_at_20%_0%,rgba(237,195,177,0.5),transparent_55%),radial-gradient(ellipse_at_90%_10%,rgba(212,184,150,0.35),transparent_50%)]"
      />
      <section className="relative px-4 pb-12 pt-16 sm:px-5 sm:pt-14 lg:px-12 lg:pb-16 lg:pt-16 xl:px-20">
        <div className="mx-auto grid max-w-6xl gap-7 lg:grid-cols-[1.1fr_0.9fr] lg:items-start lg:gap-12">
          <div>
            <span className="inline-flex rounded-full bg-terracotta px-3.5 py-1.5 font-[font2] text-[10px] uppercase tracking-[0.22em] text-white">
              Taller
            </span>
            <h1 className="mt-4 font-[font2] text-[clamp(1.85rem,4.8vw,3.25rem)] uppercase leading-[0.95] tracking-tight">{edition.title}</h1>
            {summary ? <p className="mt-4 max-w-lg font-[font1] text-base leading-snug text-black/65 lg:text-lg">{summary}</p> : null}

            <div className="mt-5 flex flex-wrap gap-2.5">
              {edition.startsAt && edition.startsAtHasTime ? (
                <LocalScheduleChips startsAtIso={edition.startsAt.toISOString()} hasTime userCountry={userCountry} />
              ) : when ? (
                <span className={chip}>
                  <CalendarDays className="h-4 w-4 text-terracotta" />
                  <span className="first-letter:uppercase">{when}</span>
                </span>
              ) : null}
              <span className={chip}>
                <Laptop className="h-4 w-4 text-terracotta" />
                En vivo · Online
              </span>
              <span className={chip}>
                <Gift className="h-4 w-4 text-terracotta" />
                Registro gratis
              </span>
            </div>

            <p className="mt-5 max-w-lg font-[font1] text-sm leading-relaxed text-black/60">
              Déjanos tus datos y te escribimos por WhatsApp para completar tu inscripción: puedes hacer el pago en el enlace de inscripción o
              agendar primero una llamada gratis con Dayana, donde te explica el taller y su valor.
            </p>
            <a
              href={`/taller-virtual/${encodeURIComponent(edition.slug)}`}
              className="mt-3 inline-flex font-[font1] text-sm text-terracotta underline decoration-terracotta/30 underline-offset-4 transition-colors hover:decoration-terracotta"
            >
              Ver todo sobre el taller
            </a>
          </div>

          <div
            id="registro"
            className="relative scroll-mt-24 rounded-[1.5rem] border border-white/50 bg-white/55 p-5 shadow-[0_24px_60px_-28px_rgba(92,74,58,0.45)] backdrop-blur-xl lg:p-7"
          >
            <div aria-hidden="true" className="pointer-events-none absolute inset-x-4 top-0 h-px bg-gradient-to-r from-transparent via-white to-transparent" />
            <div>
              <WorkshopRegisterForm
                slug={edition.slug}
                workshopTitle={edition.title}
                userCountry={userCountry}
                payPath={edition.payPath}
                whatsappHref={whatsappHref}
                refSource={refSource}
              />
            </div>
          </div>
        </div>
      </section>
    </main>
  );
};

export default WorkshopRegistrationPage;
