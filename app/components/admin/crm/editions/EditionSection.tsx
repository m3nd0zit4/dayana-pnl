"use client";

import { ChevronDown } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/app/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * Un bloque de un formulario largo (la página de un evento o de un taller).
 *
 * En el teléfono se pliega: la pestaña abre con el primero desplegado y los
 * demás como una lista de títulos, en vez de diez tarjetas seguidas que hay
 * que recorrer con el pulgar. Desde `sm` está siempre abierto: con pantalla
 * de sobra, plegar solo esconde.
 *
 * El plegado es CSS (`hidden sm:block`): lo que el servidor pinta y lo que se
 * ve al hidratar es lo mismo en los dos tamaños.
 */
const EditionSection = ({
  title,
  summary,
  defaultOpen = false,
  children,
  contentClassName,
}: {
  title: string;
  /** Una línea bajo el título cuando está plegado (p. ej. la fecha puesta). */
  summary?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
  contentClassName?: string;
}) => {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Card data-open={open ? "" : undefined}>
      <CardHeader>
        {/* Teléfono: el título es el botón que pliega. */}
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className="-m-1 flex min-h-10 w-[calc(100%+0.5rem)] items-center justify-between gap-3 rounded-md p-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/50 sm:hidden"
        >
          <span className="min-w-0">
            <span className="block font-heading text-base leading-snug font-medium uppercase tracking-wide">
              {title}
            </span>
            {summary && !open ? (
              <span className="mt-0.5 block truncate text-xs text-muted-foreground">{summary}</span>
            ) : null}
          </span>
          <ChevronDown
            aria-hidden
            className={cn("size-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")}
          />
        </button>
        {/* Desde sm siempre abierto: un título, no un control. */}
        <CardTitle className="hidden text-base uppercase tracking-wide sm:block">{title}</CardTitle>
      </CardHeader>
      <CardContent className={cn(open ? "block" : "hidden", "sm:block")}>
        <div className={cn("space-y-4", contentClassName)}>{children}</div>
      </CardContent>
    </Card>
  );
};

export default EditionSection;
