"use client";

import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import type { RefObject } from "react";

gsap.registerPlugin(ScrollTrigger);

/**
 * La receta de entrada de la casa, en un solo sitio.
 *
 * Estaba copiada casi carácter a carácter en siete componentes —`.sv-reveal`,
 * `.cc-reveal`, `.st-reveal`, `.ct-reveal`, `.fo-reveal`, `.wk-reveal`,
 * `.wk-list-reveal`—, y con ella se copió su punto débil: dos de esos siete no
 * comprueban `prefers-reduced-motion`, así que quien pide menos movimiento lo
 * recibe igual. Aquí la guarda está dentro y no se puede olvidar.
 *
 * Sobre el `stagger`: los componentes originales lo falsean con
 * `delay: i * 0.04` en vez de usar la propiedad `stagger`, y no es un descuido.
 * Cada elemento lleva **su propio ScrollTrigger**, así que entra cuando entra
 * él y no cuando entra el grupo; un `stagger` de GSAP exigiría un único trigger
 * para todos y los de abajo aparecerían antes de estar en pantalla. Se conserva
 * el patrón por eso.
 */
export type RevealOptions = {
  /** Selector dentro del `scope`. Por defecto, la convención `.reveal`. */
  selector?: string;
  /** Desplazamiento vertical inicial, en píxeles. */
  y?: number;
  duration?: number;
  ease?: string;
  /** Retardo acumulado por elemento. 0 lo desactiva. */
  step?: number;
  /** Dónde entra respecto a la ventana. */
  start?: string;
  /** Re-ejecuta cuando cambie algo (p. ej. el número de tarjetas). */
  dependencies?: unknown[];
};

export const prefersReducedMotion = (): boolean =>
  typeof window !== "undefined" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export const useReveal = (
  scope: RefObject<HTMLElement | null>,
  {
    selector = ".reveal",
    y = 48,
    duration = 0.9,
    ease = "power3.out",
    step = 0.06,
    start = "top 88%",
    dependencies = [],
  }: RevealOptions = {},
) => {
  useGSAP(
    () => {
      const targets = gsap.utils.toArray<HTMLElement>(selector);
      if (targets.length === 0) return;

      // Con movimiento reducido no se anima nada, pero tampoco se deja el
      // contenido a medias: `gsap.from` arranca en opacidad 0, así que sin
      // esta salida temprana la página se quedaría en blanco para quien más
      // necesita que no se quede en blanco.
      if (prefersReducedMotion()) {
        gsap.set(targets, { clearProps: "all" });
        return;
      }

      targets.forEach((el, i) => {
        gsap.from(el, {
          y,
          opacity: 0,
          duration,
          ease,
          delay: (i % 4) * step,
          scrollTrigger: { trigger: el, start },
        });
      });
    },
    { scope, dependencies },
  );
};

export default useReveal;
