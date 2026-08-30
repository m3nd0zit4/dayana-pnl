import Link from "next/link";

import { getCourseCover } from "@/lib/courses/covers";
import type { CatalogCourse } from "@/lib/courses/catalog";

/**
 * Una tarjeta de curso, con portada.
 *
 * La rejilla anterior era texto sobre fondo claro y se leía como un índice.
 * Un catálogo se hojea con los ojos: la portada es lo que hace que alguien se
 * detenga en "PNL para pareja" en vez de leer los siete títulos en fila.
 *
 * No lleva precio a propósito. Los ocho cursos cuestan lo mismo —la
 * mensualidad— y ponerle una cifra a cada tarjeta diría que se compran por
 * separado, que es exactamente lo contrario del modelo.
 */
const CourseCard = ({ course }: { course: CatalogCourse }) => {
  const cover = getCourseCover(course.slug);

  return (
    <Link
      href={`/cursos/${course.slug}`}
      className="group flex h-full flex-col overflow-hidden rounded-3xl border border-black/10 bg-white/60 transition-all duration-300 hover:-translate-y-1 hover:border-black/25 hover:shadow-[0_28px_60px_-28px_rgba(0,0,0,0.45)]"
    >
      <div
        className="relative aspect-[16/10] overflow-hidden"
        style={
          course.imageUrl ? undefined : { backgroundImage: cover.gradient }
        }
      >
        {course.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={course.imageUrl}
            alt=""
            loading="lazy"
            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.04]"
          />
        ) : (
          <>
            {/* La palabra clave, enorme y recortada por el borde: da textura a
                la portada sin necesitar una fotografía que no existe. */}
            <span
              aria-hidden
              className="cg-keyword pointer-events-none absolute -bottom-[0.22em] -left-[0.06em] font-[font2] text-[5.5rem] uppercase leading-none text-white/[0.09] will-change-transform sm:text-[7rem]"
            >
              {cover.keyword}
            </span>
            <span
              aria-hidden
              className="absolute right-5 top-4 font-[font2] text-sm tracking-[0.3em] text-white/45"
            >
              {cover.numeral}
            </span>
          </>
        )}

        <div className="absolute inset-x-0 bottom-0 p-5 sm:p-6">
          <h3 className="font-[font2] text-2xl uppercase leading-[0.95] text-white drop-shadow-[0_2px_12px_rgba(0,0,0,0.45)] sm:text-[1.75rem]">
            {course.title}
          </h3>
        </div>
      </div>

      <div className="flex flex-1 flex-col p-5 sm:p-6">
        <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-terracotta">
          {course.sessionsLabel}
        </p>
        {course.description && (
          <p className="mt-3 flex-1 font-[font1] text-[15px] leading-relaxed text-black/65">
            {course.description}
          </p>
        )}
        <span className="mt-5 inline-flex items-center gap-2 font-[font2] text-[11px] uppercase tracking-[0.24em] text-black/45 transition-colors group-hover:text-black">
          Ver el temario
          <span
            aria-hidden
            className="transition-transform duration-300 group-hover:translate-x-1"
          >
            →
          </span>
        </span>
      </div>
    </Link>
  );
};

export default CourseCard;
