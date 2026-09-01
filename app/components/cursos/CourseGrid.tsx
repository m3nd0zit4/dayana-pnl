"use client";

import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useRef } from "react";

import CourseCard from "./CourseCard";
import { prefersReducedMotion } from "@/app/hooks/useReveal";
import type { CatalogCourse } from "@/lib/courses/catalog";

gsap.registerPlugin(ScrollTrigger);

/**
 * La rejilla de la biblioteca, animada.
 *
 * Dos capas, y la segunda es la que la hace parecer un catálogo y no una lista:
 *
 * 1. **Entrada** — cada tarjeta con su propio ScrollTrigger, la receta de la
 *    casa. El desfase va por columna (`i % 3`) y no por índice absoluto, para
 *    que la fila entre como fila en vez de en diagonal larga.
 * 2. **Parallax de la portada** — la palabra clave gigante de `covers.ts` se
 *    mueve más despacio que su tarjeta, con el mismo patrón `data-speed` que
 *    usa `TestimonialsSection`. Es lo que da profundidad sin necesitar
 *    fotografías, que es exactamente lo que no tenemos.
 */
const CourseGrid = ({
  courses,
  isColombia,
}: {
  courses: CatalogCourse[];
  isColombia: boolean;
}) => {
  const rootRef = useRef<HTMLUListElement>(null);

  useGSAP(
    () => {
      const cards = gsap.utils.toArray<HTMLElement>(".cg-card");
      if (cards.length === 0 || prefersReducedMotion()) {
        gsap.set(cards, { clearProps: "all" });
        return;
      }

      cards.forEach((el, i) => {
        gsap.from(el, {
          y: 52,
          opacity: 0,
          scale: 0.97,
          duration: 0.9,
          ease: "power3.out",
          delay: (i % 3) * 0.08,
          scrollTrigger: { trigger: el, start: "top 90%" },
        });
      });

      // El `yPercent` es pequeño a propósito: la palabra vive dentro de un
      // contenedor con `overflow-hidden`, así que un recorrido largo la sacaría
      // del recuadro y se vería el degradado desnudo por debajo.
      gsap.utils.toArray<HTMLElement>(".cg-keyword").forEach((el) => {
        gsap.to(el, {
          yPercent: -18,
          ease: "none",
          scrollTrigger: {
            trigger: el,
            start: "top bottom",
            end: "bottom top",
            scrub: true,
          },
        });
      });
    },
    { scope: rootRef, dependencies: [courses.length] },
  );

  return (
    <ul
      ref={rootRef}
      className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3"
    >
      {courses.map((course) => (
        <li key={course.slug} className="cg-card">
          <CourseCard course={course} isColombia={isColombia} />
        </li>
      ))}
    </ul>
  );
};

export default CourseGrid;
