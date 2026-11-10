"use client";

import { useSyncExternalStore } from "react";

import { textLink } from "./styles";
import { readStoredToken, TOKEN_KEY } from "./token-store";

const subscribe = (onChange: () => void) => {
  const onStorage = (e: StorageEvent) => {
    if (e.key === null || e.key === TOKEN_KEY) onChange();
  };
  window.addEventListener("storage", onStorage);
  return () => window.removeEventListener("storage", onStorage);
};

/**
 * «¿Ya dejaste tus datos? Ver mi llamada»: para quien vuelve a `/llamada` con
 * su enlace guardado en este navegador. Es solo una línea: el enlace guardado
 * puede estar viejo, así que no se redirige a nadie.
 *
 * En el servidor no se sabe si hay enlace, así que aparece después de
 * hidratar; quien la coloca le reserva el sitio para que no empuje la página.
 */
const ReturningLink = ({ className = "" }: { className?: string }) => {
  const token = useSyncExternalStore<string | null>(subscribe, readStoredToken, () => null);
  if (!token) return null;
  return (
    <p className={`font-[font1] text-xs leading-snug text-muted-foreground ${className}`} data-testid="llamada-volver">
      ¿Ya dejaste tus datos?{" "}
      {/* Un <a> y no <Link>: su página se abre con carga completa, sin el Pixel ni GTM de esta. */}
      <a href={`/llamada/${encodeURIComponent(token)}`} className={`${textLink} font-[font2]`}>
        Ver mi llamada
      </a>
    </p>
  );
};

export default ReturningLink;
