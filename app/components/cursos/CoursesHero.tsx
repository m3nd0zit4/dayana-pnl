import SplitReveal from "@/app/components/ui/SplitReveal";
import WebinarMuxVideo from "@/app/components/webinar/WebinarMuxVideo";
import type { CoursesHero as HeroData } from "@/lib/courses/hero";

/**
 * La apertura de `/cursos`.
 *
 * Todo lo que la distingue —el vídeo de invitación, la foto, la oferta— vive
 * en `SiteSetting` y puede no existir. Por eso el componente está escrito al
 * revés de lo habitual: primero el texto, que siempre está, y el material
 * gráfico como añadido. Sin nada configurado se sirve exactamente el hero
 * tipográfico que la página tenía antes, y eso no es un modo degradado sino
 * el estado por defecto.
 *
 * El titular se parte por saltos de línea porque `SplitReveal` anima línea a
 * línea; el copy por defecto los lleva puestos.
 */

const FALLBACK_TITLE = `Una mensualidad.
Toda la biblioteca.`;

// Sin cifra a propósito. Decía «Ocho cursos» y la biblioteca tiene los que
// tenga publicados —hoy siete—, así que el titular mentía en la primera línea
// de la página. El recuento real va debajo, leído de la base.
const FALLBACK_TITLE_MIXED = `Elige un curso.
O entra a todos.`;

const CoursesHero = ({
  hero,
  lessonCount,
  courseCount,
  /** ¿Hay algún curso a la venta suelta? Cambia la promesa del titular. */
  hasStandaloneSales,
}: {
  hero: HeroData;
  lessonCount: number;
  courseCount: number;
  hasStandaloneSales: boolean;
}) => {
  // El titular por defecto describe el catálogo que existe hoy. Prometer «una
  // mensualidad» cuando además hay cursos sueltos sería describir un modelo
  // que la propia página desmiente tres secciones más abajo.
  const title =
    hero.title ?? (hasStandaloneSales ? FALLBACK_TITLE_MIXED : FALLBACK_TITLE);

  const subtitle =
    hero.subtitle ??
    (hasStandaloneSales
      ? "Compra un curso suelto y es tuyo para siempre, o activa la membresía y entra a todos mientras esté al día."
      : "No eliges un curso: entras a todos. Mientras la mensualidad esté activa tienes acceso completo, y cuando se publica uno nuevo también lo tienes.");

  return (
    <section className="mx-auto w-full max-w-5xl px-5 pb-16 pt-28 sm:px-8 sm:pt-36">
      <div className="flex flex-col gap-10 lg:flex-row lg:items-center lg:gap-14">
        <div className="lg:flex-1">
          <p className="font-[font2] text-[10px] uppercase tracking-[0.3em] text-terracotta">
            {hero.eyebrow ?? "Biblioteca de cursos"}
          </p>

          <SplitReveal
            text={title}
            className="mt-5 max-w-3xl font-[font2] text-4xl uppercase leading-[0.92] sm:text-6xl"
          />

          <p className="mt-6 max-w-xl font-[font1] text-lg leading-snug text-black/65">
            {subtitle}
          </p>

          {/* Los números salen de la base, nunca escritos a mano: un catálogo
              que anuncia lecciones que no existe es la forma más barata de
              perder la confianza en la primera pantalla. */}
          {courseCount > 0 && (
            <p className="mt-6 font-mono text-[11px] uppercase tracking-[0.24em] text-black/45">
              {courseCount} {courseCount === 1 ? "curso" : "cursos"}
              {lessonCount > 0 ? ` · ${lessonCount} lecciones` : ""}
            </p>
          )}

          {hero.offer && (
            <p className="mt-7 inline-flex items-center gap-3 rounded-full border border-terracotta/35 bg-terracotta/10 px-5 py-2.5">
              <span className="font-[font2] text-[11px] uppercase tracking-[0.24em] text-terracotta">
                {hero.offer.label}
              </span>
            </p>
          )}
        </div>

        {hero.media && (
          <div className="overflow-hidden rounded-3xl border border-black/10 bg-black/5 lg:w-[46%]">
            {hero.media.kind === "video" ? (
              <WebinarMuxVideo
                playbackId={hero.media.playbackId}
                title="Dayana te invita a los cursos"
              />
            ) : (
              // `next/image` no: la URL la escribe el equipo desde el panel y
              // no hay `images.remotePatterns` en next.config que la cubra —
              // el optimizador la rechazaría en tiempo de ejecución. Mismo
              // criterio que la portada de `CourseCard`.
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={hero.media.url}
                alt="Dayana Beltrán"
                className="h-full w-full object-cover"
              />
            )}
          </div>
        )}
      </div>
    </section>
  );
};

export default CoursesHero;
