import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Estado vacío único (regla R9).
 *
 * Sustituye ~20 versiones en línea repartidas en cinco formas distintas:
 * título en negrita + botón outline, título + párrafo apagado, título + enlace
 * ghost, un párrafo suelto sin más, y una sola con icono. Cada lista del CRM
 * se lo inventaba.
 */

type Props = {
  icon?: LucideIcon;
  title: string;
  description?: ReactNode;
  /** Una sola acción, y solo si de verdad desbloquea el vacío. */
  action?: ReactNode;
  className?: string;
};

const CrmEmptyState = ({
  icon: Icon,
  title,
  description,
  action,
  className,
}: Props) => (
  <div
    data-crm-empty=""
    className={cn(
      "flex flex-col items-center gap-3 px-6 py-12 text-center",
      className,
    )}
  >
    {Icon ? (
      <Icon
        className="size-8 text-muted-foreground/60"
        strokeWidth={1.5}
        aria-hidden
      />
    ) : null}
    <div className="space-y-1">
      <h2 className="text-sm font-semibold tracking-tight">{title}</h2>
      {description ? (
        <p className="mx-auto max-w-sm text-sm text-muted-foreground">
          {description}
        </p>
      ) : null}
    </div>
    {action ? <div className="pt-1">{action}</div> : null}
  </div>
);

export default CrmEmptyState;
