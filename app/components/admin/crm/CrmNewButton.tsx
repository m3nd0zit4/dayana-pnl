"use client";

import { Plus } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Button } from "@/app/components/ui/button";

type Props = {
  label?: string;
  onClick: () => void;
  disabled?: boolean;
  /** Solo si «crear» aquí no es un `+` (p. ej. añadir un miembro). */
  icon?: LucideIcon;
  className?: string;
};

/**
 * Acción primaria de creación. Va en el slot `action` de `CrmPageHeader` y en
 * ningún otro sitio (regla R2).
 *
 * Existía ya, pero cinco páginas se lo reimplementaban en línea y una de ellas
 * se dejaba el `hidden sm:inline`, así que su etiqueta nunca colapsaba en
 * móvil. El `data-crm-primary-action` es lo que permite al contrato comprobar
 * que hay exactamente una y que está dentro de la cabecera.
 */
const CrmNewButton = ({
  label = "Nuevo",
  onClick,
  disabled = false,
  icon: Icon = Plus,
  className,
}: Props) => (
  <Button
    data-crm-primary-action=""
    size="sm"
    onClick={onClick}
    disabled={disabled}
    className={className}
  >
    <Icon strokeWidth={2} aria-hidden />
    <span className="hidden sm:inline">{label}</span>
  </Button>
);

export default CrmNewButton;
