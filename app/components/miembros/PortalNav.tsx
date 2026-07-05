"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";

const LINKS = [
  { href: "/miembros", label: "Inicio", exact: true },
  { href: "/miembros/clases", label: "Clases" },
  { href: "/miembros/modulos", label: "Módulos" },
  { href: "/miembros/cuenta", label: "Mi cuenta" },
];

const PortalNav = ({ firstName }: { firstName: string }) => {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-40 border-b border-linen/10 bg-black/85 backdrop-blur">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-4 lg:px-8">
        <Link
          href="/miembros"
          className="shrink-0 font-[font2] uppercase leading-none"
        >
          <span className="block text-sm tracking-[0.14em] text-linen">
            Dayana Beltrán
          </span>
          <span className="mt-1 block text-[9px] tracking-[0.45em] text-white/45">
            Miembros
          </span>
        </Link>

        <nav
          aria-label="Portal"
          className="flex items-center gap-1 overflow-x-auto"
        >
          {LINKS.map((link) => {
            const active = link.exact
              ? pathname === link.href
              : pathname.startsWith(link.href);
            return (
              <Link
                key={link.href}
                href={link.href}
                className={`whitespace-nowrap rounded-full px-3.5 py-2 font-[font2] uppercase text-[10px] tracking-[0.2em] transition-colors ${
                  active
                    ? "bg-linen text-black"
                    : "text-white/60 hover:bg-linen/10 hover:text-white"
                }`}
              >
                {link.label}
              </Link>
            );
          })}
        </nav>

        <div className="hidden shrink-0 items-center gap-3 sm:flex">
          <span className="font-[font1] text-xs text-white/45">
            {firstName}
          </span>
          <button
            type="button"
            onClick={() => signOut({ callbackUrl: "/acceso" })}
            className="rounded-full border border-linen/20 px-3.5 py-2 font-[font2] uppercase text-[10px] tracking-[0.2em] text-white/60 transition-colors hover:bg-linen/10 hover:text-white"
          >
            Salir
          </button>
        </div>
      </div>
    </header>
  );
};

export default PortalNav;
