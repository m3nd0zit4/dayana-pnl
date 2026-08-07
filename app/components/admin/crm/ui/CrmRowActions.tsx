"use client";

import { Pencil, Trash2 } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/app/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Grupo de acciones de una fila (reglas R6 y R7).
 *
 * Había cuatro estilos conviviendo: solo icono en Talleres, texto `ghost sm` en
 * Paquetes y Códigos, solo icono con Editar pero sin Eliminar en Equipo, y en
 * Módulos los tres mezclados en un mismo grupo. Y Eliminar salía en rojo en dos
 * sitios y en gris en otros dos.
 *
 * El orden lo fija el contenedor por composición: previsualizar → propias →
 * editar → eliminar. Eliminar siempre el último, porque es el que no se
 * deshace y no debe caer donde el dedo va por inercia.
 *
 * Sobre el color: aquí Eliminar es `ghost` con texto destructivo, no la
 * variante `destructive` del botón. Esa variante es un relleno suave
 * (`bg-destructive/10`) que a densidad de fila se lee como un resaltado
 * permanente, y una lista de diez filas acaba pareciendo diez errores. El
 * relleno se reserva para el diálogo de confirmación.
 */

type GroupProps = {
  children: ReactNode;
  className?: string;
};

export const CrmRowActions = ({ children, className }: GroupProps) => (
  <div className={cn("flex items-center gap-0.5", className)}>{children}</div>
);

type ActionProps = {
  icon: LucideIcon;
  /** Obligatoria: son botones sin texto. Se usa en `aria-label` y `title`. */
  label: string;
  onClick?: () => void;
  disabled?: boolean;
  className?: string;
};

/** Acción genérica de fila. Para previsualizar usar `CrmPublicLink density="row"`. */
export const CrmRowAction = ({
  icon: Icon,
  label,
  onClick,
  disabled,
  className,
}: ActionProps) => (
  <Button
    variant="ghost"
    size="icon-sm"
    onClick={onClick}
    disabled={disabled}
    aria-label={label}
    title={label}
    className={className}
  >
    <Icon aria-hidden />
  </Button>
);

export const CrmRowEdit = ({
  label = "Editar",
  ...props
}: Omit<ActionProps, "icon" | "label"> & { label?: string }) => (
  <CrmRowAction icon={Pencil} label={label} {...props} />
);

export const CrmRowDelete = ({
  label = "Eliminar",
  className,
  ...props
}: Omit<ActionProps, "icon" | "label"> & { label?: string }) => (
  <CrmRowAction
    icon={Trash2}
    label={label}
    className={cn(
      "text-destructive hover:bg-destructive/10 hover:text-destructive",
      className,
    )}
    {...props}
  />
);

export default CrmRowActions;
