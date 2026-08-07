"use client";

import { Check, Copy, ExternalLink } from "lucide-react";
import { useState } from "react";
import { Button } from "@/app/components/ui/button";
import { useCrm } from "../CrmProvider";

/**
 * Enlace a la página pública que gestiona esta sección del CRM (regla R4).
 *
 * Esto existe porque «ver la página pública» estaba resuelto de cinco maneras
 * distintas: un icono suelto en la barra superior, un icono enterrado en medio
 * de un grupo de cinco en la fila de Talleres, una pastilla con clases escritas
 * a mano en la cabecera de Webinar, un `<a>` subrayado en Contenido, y un
 * enlace de navegación en el sidebar. Mismo trabajo, cinco posiciones y cinco
 * estilos.
 *
 * Tres densidades, una sola implementación:
 *
 *  - `page` — botón con etiqueta visible, en `CrmPageHeader.secondaryActions`.
 *    Nunca solo icono a nivel de página: si la acción merece estar en la
 *    cabecera, merece nombre.
 *  - `row` — solo icono, dentro del grupo de acciones de una fila.
 *  - `chrome` — la barra superior. Sigue siendo solo icono porque es cromo de
 *    la aplicación, no una acción de la página, pero comparte `target`/`rel`.
 *
 * `disabledReason` cubre el caso honesto: cuando la página pública devolvería
 * un 404 (webinar sin publicar, taller en el slug centinela) el botón se
 * muestra deshabilitado explicando por qué, en vez de llevarte a un error.
 */

type Density = "page" | "row" | "chrome";

type Props = {
  href: string;
  /** Etiqueta visible en `page`; texto accesible en `row` y `chrome`. */
  label?: string;
  density?: Density;
  /** Añade un botón de copiar la URL absoluta. */
  copy?: boolean;
  /** Si se indica, el enlace se deshabilita y esto explica el motivo. */
  disabledReason?: string;
  className?: string;
};

const absoluteUrl = (href: string) =>
  href.startsWith("http")
    ? href
    : `${typeof window === "undefined" ? "" : window.location.origin}${href}`;

const CrmPublicLink = ({
  href,
  label = "Ver página",
  density = "page",
  copy = false,
  disabledReason,
  className,
}: Props) => {
  const { toast } = useCrm();
  const [copied, setCopied] = useState(false);

  const iconOnly = density !== "page";
  const disabled = Boolean(disabledReason);

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(absoluteUrl(href));
      setCopied(true);
      toast("Enlace copiado");
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      toast({ message: "No se pudo copiar el enlace", variant: "error" });
    }
  };

  const link = disabled ? (
    <Button
      data-crm-public-link=""
      variant={iconOnly ? "ghost" : "outline"}
      size={iconOnly ? "icon-sm" : "sm"}
      disabled
      title={disabledReason}
      aria-label={iconOnly ? `${label} — ${disabledReason}` : undefined}
      className={className}
    >
      <ExternalLink aria-hidden />
      {iconOnly ? null : label}
    </Button>
  ) : (
    <Button
      data-crm-public-link=""
      variant={iconOnly ? "ghost" : "outline"}
      size={iconOnly ? "icon-sm" : "sm"}
      title={label}
      aria-label={iconOnly ? label : undefined}
      className={className}
      nativeButton={false}
      render={<a href={href} target="_blank" rel="noopener noreferrer" />}
    >
      <ExternalLink aria-hidden />
      {iconOnly ? null : label}
    </Button>
  );

  if (!copy) return link;

  return (
    <div className="flex items-center gap-1">
      {link}
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={onCopy}
        title="Copiar enlace"
        aria-label="Copiar enlace"
      >
        {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
      </Button>
    </div>
  );
};

export default CrmPublicLink;
