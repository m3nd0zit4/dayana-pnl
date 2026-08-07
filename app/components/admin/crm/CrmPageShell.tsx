import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Contenedor único de toda página del CRM (regla R1 del contrato).
 *
 * Dos cosas que antes cada página resolvía por su cuenta y ahora viven aquí:
 *
 *  - **Ancho máximo.** Ninguna página del panel lo tenía, así que en un monitor
 *    ancho las filas de listas se estiraban hasta el borde y se volvían
 *    ilegibles. `narrow` es para páginas que son solo un formulario.
 *  - **Ritmo vertical.** Había `space-y-4`, `-5`, `-6`, `-8`, `-10` y dos
 *    páginas sin envoltorio. Ahora es `space-y-6` y punto; dentro de una Card,
 *    `space-y-4`.
 *
 * El padding exterior sigue en `.crm-page-shell` (`app/admin/crm.css`), que es
 * responsive y no depende del ancho del contenido.
 */

const WIDTHS = {
  default: "max-w-6xl",
  narrow: "max-w-3xl",
  full: "max-w-none",
} as const;

type Props = {
  children: ReactNode;
  /** `full` renuncia al ancho máximo: solo para layouts de dos paneles. */
  width?: keyof typeof WIDTHS;
  className?: string;
};

const CrmPageShell = ({ children, width = "default", className }: Props) => (
  <div className="crm-page-shell">
    <div
      data-crm-page=""
      data-crm-width={width}
      className={cn("mx-auto w-full space-y-6", WIDTHS[width], className)}
    >
      {children}
    </div>
  </div>
);

export default CrmPageShell;
