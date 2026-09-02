"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

/**
 * La carcasa de `/cuenta`.
 *
 * Antes esto vivía dentro del portal, envuelto en la barra lateral de
 * `PortalSidebar`, y por eso la cuenta salía con dos identidades a la vez: el
 * avatar del portal a la izquierda y el de la cabecera del sitio arriba a la
 * derecha, cada uno con su propio menú. La cuenta no es una sección del curso
 * —se llega a ella desde cualquier página—, así que ahora usa la cabecera
 * normal del sitio y su único control de identidad es el de arriba a la
 * derecha.
 *
 * La navegación es de pestañas y no de barra lateral: son cuatro apartados y
 * una columna entera para cuatro enlaces deja la mitad de la pantalla vacía en
 * escritorio y obliga a hacer scroll horizontal en móvil.
 */

const TABS = [
  { href: "/cuenta", label: "Perfil" },
  { href: "/cuenta/seguridad", label: "Seguridad" },
  { href: "/cuenta/notificaciones", label: "Avisos" },
  { href: "/cuenta/facturacion", label: "Pagos" },
] as const;

const CuentaShell = ({
  firstName,
  children,
}: {
  firstName: string | null;
  children: ReactNode;
}) => {
  const pathname = usePathname() ?? "";

  return (
    <main className="mx-auto w-full max-w-3xl px-5 pb-24 pt-28 sm:px-8 sm:pt-36">
      <p className="font-[font2] text-[10px] uppercase tracking-[0.3em] text-terracotta">
        Tu cuenta
      </p>
      <h1 className="mt-4 font-[font2] text-4xl uppercase leading-[0.92] sm:text-5xl">
        {firstName ? `Hola, ${firstName}` : "Tu cuenta"}
      </h1>

      <nav
        aria-label="Secciones de la cuenta"
        className="mt-10 flex gap-1 overflow-x-auto border-b border-black/10 pb-px"
      >
        {TABS.map((tab) => {
          // `/cuenta` es prefijo de todas las demás, así que la raíz sólo se
          // marca con igualdad exacta o el perfil quedaría activo siempre.
          const active =
            tab.href === "/cuenta"
              ? pathname === "/cuenta"
              : pathname.startsWith(tab.href);
          return (
            <Link
              key={tab.href}
              href={tab.href}
              aria-current={active ? "page" : undefined}
              className={`-mb-px shrink-0 border-b-2 px-4 py-3 font-[font2] text-[11px] uppercase tracking-[0.2em] transition-colors ${
                active
                  ? "border-terracotta text-ink"
                  : "border-transparent text-black/45 hover:border-black/20 hover:text-black"
              }`}
            >
              {tab.label}
            </Link>
          );
        })}
      </nav>

      <div className="mt-10 space-y-10">{children}</div>
    </main>
  );
};

export default CuentaShell;
