import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Pie de acciones de un formulario (regla R5).
 *
 * Había cuatro convenciones distintas para el mismo botón Guardar: abajo a la
 * izquierda y sin tamaño en Webinar, abajo a la derecha dentro de la Card en
 * el detalle de módulo, y dos pies de modal con el **orden opuesto** entre sí
 * — Talleres pone Cancelar y luego Guardar, Paquetes ponía Guardar y luego
 * Cancelar, alineados a la izquierda.
 *
 * Aquí siempre: alineado a la derecha, primario el último. En móvil se apila
 * con `flex-col-reverse`, de modo que el primario queda arriba — que es donde
 * llega el pulgar y donde el orden de lectura lo espera.
 *
 * El `data-crm-form-actions` es lo que permite al contrato abrir el modal de
 * verdad y comprobar que el último botón es el primario.
 */

type Props = {
  children: ReactNode;
  /** `sm` para pies dentro de una Card; `default` para formularios de página. */
  size?: "sm" | "default";
  className?: string;
};

const CrmFormActions = ({ children, size = "default", className }: Props) => (
  <div
    data-crm-form-actions=""
    className={cn(
      "flex flex-col-reverse gap-2 sm:flex-row sm:justify-end",
      size === "default" ? "mt-6" : "mt-4",
      className,
    )}
  >
    {children}
  </div>
);

export default CrmFormActions;
