"use client";

import type { ReactNode } from "react";
import { Field } from "@base-ui/react/field";
import { Fieldset } from "@base-ui/react/fieldset";
import { cn } from "@/lib/utils";

/**
 * Un campo de formulario del CRM.
 *
 * Existe porque el panel tenía sesenta copias a mano del mismo bloque:
 *
 *     <div className="space-y-1.5">
 *       <Label htmlFor="x">…</Label>
 *       <Input id="x" … />
 *       <p className="text-xs text-muted-foreground">…</p>
 *     </div>
 *
 * Doce de ellas sólo en Paquetes. Escribirlo a mano obliga a acordarse del
 * `htmlFor`/`id` en cada sitio —y basta que uno no cuadre para que la etiqueta
 * deje de leerse con lector de pantalla—, y deja el error de campo a la
 * improvisación de quien escribe la pantalla.
 *
 * `Field` de Base UI ya venía instalado con el resto de primitivos y no se
 * usaba en ningún sitio. Trae, sin escribir nada:
 *
 * - El enlace etiqueta↔control resuelto solo, sin `id` a mano.
 * - `Field.Error`, que es exactamente el `role="alert"` en rojo que pide la R9
 *   del contrato, y que aparece solo cuando hay error.
 * - Los estados `data-dirty`, `data-touched` e `data-invalid` en el DOM: de ahí
 *   sale «hay cambios sin guardar» sin llevar la cuenta a mano.
 *
 * La descripción va DEBAJO del control y no encima a propósito: es una nota,
 * no una instrucción previa, y encima empuja el campo hacia abajo en un
 * formulario que ya va justo de alto.
 */

type CrmFieldProps = {
  label: ReactNode;
  /** Nota corta bajo el control. Si es larga, probablemente sobre. */
  description?: ReactNode;
  /** Mensaje de error. Presente = campo inválido. */
  error?: string | null;
  /** Nombre para `Form errors={{…}}`, que sirve el servidor. */
  name?: string;
  className?: string;
  /**
   * El control. Se le pasa por `render` a `Field.Control`, así que puede ser
   * `<Input />`, `<Textarea />` o cualquier otro: Base UI le inyecta el `id`,
   * el `aria-labelledby` y el `aria-invalid`.
   */
  children: ReactNode;
};

export const CrmField = ({
  label,
  description,
  error,
  name,
  className,
  children,
}: CrmFieldProps) => (
  <Field.Root
    name={name}
    invalid={Boolean(error)}
    className={cn("flex flex-col gap-1.5", className)}
  >
    <Field.Label className="flex items-center gap-2 text-sm leading-none font-medium select-none">
      {label}
    </Field.Label>

    <Field.Control render={children as React.ReactElement} />

    {description ? (
      <Field.Description className="text-xs text-muted-foreground">
        {description}
      </Field.Description>
    ) : null}

    {/*
      `match` a `true` porque la validación la decide el servidor o el propio
      formulario, no el navegador: el mensaje llega ya resuelto en `error`.
    */}
    {error ? (
      <Field.Error match className="text-sm text-destructive">
        {error}
      </Field.Error>
    ) : null}
  </Field.Root>
);

/**
 * Grupo de campos con su título.
 *
 * Sustituye a los `border-t pt-4` con un `<p>` haciendo de encabezado, que
 * agrupaban sólo de forma visual: para un lector de pantalla los campos
 * quedaban sueltos. `Fieldset` los agrupa de verdad con su `<legend>`.
 */
export const CrmFieldset = ({
  legend,
  children,
  className,
}: {
  legend: ReactNode;
  children: ReactNode;
  className?: string;
}) => (
  <Fieldset.Root className={cn("flex flex-col gap-4 border-t pt-4", className)}>
    <Fieldset.Legend className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
      {legend}
    </Fieldset.Legend>
    {children}
  </Fieldset.Root>
);
