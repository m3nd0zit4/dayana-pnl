import Link from "next/link";

import { getCourseCover } from "@/lib/courses/covers";
import type { CatalogCourse } from "@/lib/courses/catalog";
import { formatCop, formatUsd, type Plan } from "@/lib/plans";

/**
 * Una tarjeta de curso, con portada.
 *
 * La rejilla anterior era texto sobre fondo claro y se leía como un índice.
 * Un catálogo se hojea con los ojos: la portada es lo que hace que alguien se
 * detenga en "PNL para pareja" en vez de leer los ocho títulos en fila.
 *
 * **El pie cuenta tres historias distintas** según quién mire:
 *
 * - Sin sesión, o sin acceso a este curso — su precio suelto si está a la
 *   venta, y si no, nada. Durante mucho tiempo ninguna tarjeta llevó cifra
 *   porque no había nada que comprar por separado; ponerla cuando no lo hay
 *   seguiría diciendo lo contrario del modelo.
 * - Con acceso y sin empezar — «Empezar».
 * - Con acceso y empezado — la barra de progreso y «Continuar», que lleva
 *   directamente a la siguiente lección sin completar y no al temario.
 */

const priceOf = (plan: Plan, isColombia: boolean) =>
  isColombia && plan.amountCop != null
    ? formatCop(plan.amountCop)
    : formatUsd(plan.amountUsd);

const listPriceOf = (plan: Plan, isColombia: boolean) => {
  if (isColombia) {
    return plan.listAmountCop != null && plan.amountCop != null
      ? formatCop(plan.listAmountCop)
      : null;
  }
  return plan.listAmountUsd != null ? formatUsd(plan.listAmountUsd) : null;
};

const CourseCard = ({
  course,
  isColombia,
}: {
  course: CatalogCourse;
  isColombia: boolean;
}) => {
  const cover = getCourseCover(course.slug);
  const access = course.access;
  const hasAccess = access?.hasAccess ?? false;
  const started = (access?.completedLessons ?? 0) > 0;
  const complete = hasAccess && access != null && access.percent === 100;

  // Con acceso la tarjeta deja de ser escaparate y pasa a ser puerta: lleva a
  // la lección donde lo dejó, no al temario que ya conoce.
  const href = hasAccess
    ? access?.nextClassId
      ? `/miembros/curso/${course.slug}?c=${access.nextClassId}`
      : `/miembros/curso/${course.slug}`
    : `/cursos/${course.slug}`;

  const cta = complete
    ? "Repasar"
    : hasAccess
      ? started
        ? "Continuar"
        : "Empezar"
      : "Ver el temario";

  const list = course.plan ? listPriceOf(course.plan, isColombia) : null;

  return (
    <Link
      href={href}
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

        {hasAccess && (
          <span className="absolute left-5 top-4 rounded-full bg-black/45 px-3 py-1 font-[font2] text-[10px] uppercase tracking-[0.2em] text-white backdrop-blur-sm">
            {complete ? "Completado" : "Tu acceso"}
          </span>
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

        {hasAccess && started && !complete && access && (
          <div className="mt-5">
            {/* Barra a mano y no el primitivo de shadcn: esta tarjeta es un
                server component y no debe arrastrar cliente por una barra. */}
            <div
              className="h-1 w-full overflow-hidden rounded-full bg-black/10"
              role="progressbar"
              aria-valuenow={access.percent}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={`Progreso de ${course.title}`}
            >
              <div
                className="h-full rounded-full bg-terracotta"
                style={{ width: `${access.percent}%` }}
              />
            </div>
            {/* Sin total. `sessionsLabel` («7 módulos · 50 lecciones») está
                escrito a mano en curso.json y se desfasa del recuento real de
                la base: poner las dos cifras en la misma tarjeta dejaba «50
                lecciones» arriba y «de 56» aquí debajo. La barra ya comunica
                la proporción. */}
            <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.2em] text-black/45">
              {access.completedLessons}{" "}
              {access.completedLessons === 1
                ? "lección completada"
                : "lecciones completadas"}
            </p>
          </div>
        )}

        {!hasAccess && course.plan && (
          <p className="mt-5 flex items-baseline gap-2">
            <span className="font-[font2] text-xl leading-none">
              {priceOf(course.plan, isColombia)}
            </span>
            {list && (
              <span className="font-[font1] text-sm text-black/40 line-through">
                {list}
              </span>
            )}
            <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-black/45">
              suelto
            </span>
          </p>
        )}

        <span className="mt-5 inline-flex items-center gap-2 font-[font2] text-[11px] uppercase tracking-[0.24em] text-black/45 transition-colors group-hover:text-black">
          {cta}
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
