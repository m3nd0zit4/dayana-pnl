import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/app/components/ui/button";

/**
 * Cabecera única de página del CRM (reglas R2 y R3 del contrato).
 *
 * Antes existía este componente pero solo lo usaban 3 de 21 secciones, porque
 * no tenía hueco para una descripción — así que toda página que necesitaba
 * subtítulo se escribía su propio `<h1>`. Había 18 copias del mismo markup con
 * cuatro alineaciones distintas.
 *
 * Decisiones que el componente impone y no admite variación:
 *
 *  - `items-start`, no `items-end` ni `items-center`. Los otros dos se rompen
 *    en cuanto hay descripción, y ahora la descripción es lo normal.
 *  - La **acción primaria va en la columna derecha**, no pegada al `<h1>`.
 *    Antes iba junto al título en las 3 páginas que usaban este componente.
 *  - Volver es un enlace encima del título, no un breadcrumb. La profundidad de
 *    rutas es ≤2 y el sidebar ya dice en qué sección estás.
 */

type Props = {
  title: string;
  description?: ReactNode;
  /** Enlace «volver», encima del título. Sustituye los 3 back-links a mano. */
  backHref?: string;
  backLabel?: string;
  /** Acción primaria — siempre la más a la derecha. Marcarla con `data-crm-primary-action`. */
  action?: ReactNode;
  /** Acciones de apoyo (previsualizar, refrescar…), a la izquierda de la primaria. */
  secondaryActions?: ReactNode;
  /** Contenido a ancho completo bajo la cabecera: tabs, filtros… */
  trailing?: ReactNode;
};

const CrmPageHeader = ({
  title,
  description,
  backHref,
  backLabel = "Volver",
  action,
  secondaryActions,
  trailing,
}: Props) => (
  <header data-crm-page-header="" className="space-y-4">
    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        {backHref ? (
          <Button
            variant="ghost"
            size="sm"
            className="-ml-2 mb-1 text-muted-foreground"
            nativeButton={false}
            render={<Link href={backHref} />}
          >
            <ArrowLeft aria-hidden />
            {backLabel}
          </Button>
        ) : null}
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {description ? (
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            {description}
          </p>
        ) : null}
      </div>

      {action || secondaryActions ? (
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {secondaryActions}
          {action}
        </div>
      ) : null}
    </div>
    {trailing}
  </header>
);

export default CrmPageHeader;
