"use client";

import { useRef, type ReactNode } from "react";

import useReveal, { type RevealOptions } from "@/app/hooks/useReveal";

/**
 * Envuelve contenido de servidor y anima lo que lleve `.reveal` dentro.
 *
 * `/cursos`, `/dayana`, `/historias` y la página de resultado son server
 * components a propósito: hacen consultas y deben renderizar sin JavaScript.
 * Convertirlas en cliente sólo para animarlas sería pagar un precio muy alto
 * por una entrada. Este envoltorio es la pieza mínima de cliente —un `ref` y
 * un hook— y deja el resto del árbol donde estaba.
 */
const RevealScope = ({
  children,
  className,
  ...options
}: RevealOptions & { children: ReactNode; className?: string }) => {
  const ref = useRef<HTMLDivElement>(null);
  useReveal(ref, options);
  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  );
};

export default RevealScope;
