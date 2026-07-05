"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import { BookOpen, Home, LogOut, User, Video } from "lucide-react";

const LINKS = [
  { href: "/miembros", label: "Inicio", icon: Home, exact: true },
  { href: "/miembros/clases", label: "Clases", icon: Video, exact: false },
  { href: "/miembros/modulos", label: "Módulos", icon: BookOpen, exact: false },
  { href: "/miembros/cuenta", label: "Mi cuenta", icon: User, exact: false },
];

const isActive = (pathname: string, href: string, exact: boolean) =>
  exact ? pathname === href : pathname.startsWith(href);

const Brand = () => (
  <Link href="/miembros" className="portal-display block leading-none">
    <span className="block text-sm tracking-[0.14em] text-[var(--portal-foreground)]">
      Dayana Beltrán
    </span>
    <span className="mt-1 block text-[9px] tracking-[0.45em] text-[var(--portal-muted)]">
      Portal del curso
    </span>
  </Link>
);

const PortalSidebar = ({ firstName }: { firstName: string }) => {
  const pathname = usePathname();

  return (
    <>
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-[var(--portal-sidebar-w)] flex-col border-r border-[var(--portal-border)] bg-[var(--portal-card)] px-4 py-6 lg:flex">
        <Brand />

        <nav aria-label="Portal" className="mt-8 flex flex-1 flex-col gap-1">
          {LINKS.map(({ href, label, icon: Icon, exact }) => (
            <Link
              key={href}
              href={href}
              data-active={isActive(pathname, href, exact)}
              className="portal-sidebar-link"
            >
              <Icon className="size-4 shrink-0" aria-hidden />
              {label}
            </Link>
          ))}
        </nav>

        <div className="border-t border-[var(--portal-border)] pt-4">
          <div className="px-1 text-xs text-[var(--portal-muted)]">
            {firstName}
          </div>
          <button
            type="button"
            onClick={() => signOut({ callbackUrl: "/acceso" })}
            className="portal-sidebar-link mt-2 w-full"
          >
            <LogOut className="size-4 shrink-0" aria-hidden />
            Salir
          </button>
        </div>
      </aside>

      {/* Mobile top bar */}
      <header className="sticky top-0 z-40 border-b border-[var(--portal-border)] bg-[var(--portal-card)]/95 backdrop-blur lg:hidden">
        <div className="flex items-center justify-between px-4 pt-3">
          <Brand />
          <button
            type="button"
            onClick={() => signOut({ callbackUrl: "/acceso" })}
            aria-label="Salir"
            className="rounded-full border border-[var(--portal-border)] p-2 text-[var(--portal-muted)]"
          >
            <LogOut className="size-4" aria-hidden />
          </button>
        </div>
        <nav
          aria-label="Portal"
          className="flex gap-1 overflow-x-auto px-3 py-2"
        >
          {LINKS.map(({ href, label, exact }) => {
            const active = isActive(pathname, href, exact);
            return (
              <Link
                key={href}
                href={href}
                className={`portal-display whitespace-nowrap rounded-full px-3.5 py-2 text-[10px] ${
                  active
                    ? "bg-[var(--portal-accent)] text-white"
                    : "text-[var(--portal-muted)]"
                }`}
              >
                {label}
              </Link>
            );
          })}
        </nav>
      </header>
    </>
  );
};

export default PortalSidebar;
