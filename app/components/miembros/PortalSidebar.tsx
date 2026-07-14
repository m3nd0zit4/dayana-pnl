"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import { LogOut, User } from "lucide-react";
import type { MembershipLockState } from "@/lib/lms/membership";
import {
  MembershipBlockScreen,
  MembershipWarningBanner,
} from "./MembershipLockOverlay";

const LINKS = [{ href: "/miembros", label: "Inicio", exact: true }];

const ACCOUNT_LINK = {
  href: "/miembros/cuenta",
  label: "Mi cuenta",
  exact: false,
};

const isActive = (pathname: string, href: string, exact: boolean) =>
  exact ? pathname === href : pathname.startsWith(href);

const Brand = () => (
  <Link href="/miembros" className="block leading-none uppercase">
    <span className="block text-sm tracking-[0.14em]">Dayana Beltrán</span>
    <span className="mt-1 block text-[9px] tracking-[0.45em] text-muted-foreground">
      Portal del curso
    </span>
  </Link>
);

const PortalSidebar = ({
  firstName,
  lockState,
  children,
}: {
  firstName: string;
  lockState: MembershipLockState;
  children: ReactNode;
}) => {
  const pathname = usePathname();
  const bypassBanner = pathname === ACCOUNT_LINK.href;
  // The dashboard (course cards, each showing its own lock/CTA) and the
  // course player (its own inline "unlock full access" paywall in the main
  // pane) render their own locked states — the whole-shell block only
  // applies to the rest of the portal. The warning banner (grace period,
  // not yet blocked) still applies everywhere else it always has.
  const bypassBlock =
    bypassBanner || pathname === "/miembros" || pathname.startsWith("/miembros/curso/");
  const blocked = !bypassBlock && lockState.kind === "blocked";
  const warning = !bypassBanner && lockState.kind === "warning";
  // The course player is a two-pane layout (sidebar + content) that needs
  // real width to not look cramped; everything else reads better at a
  // narrower, centered width.
  const isCoursePlayer = pathname.startsWith("/miembros/curso/");
  const contentMaxWidth = "max-w-5xl";

  // The course player owns its own full-viewport sidebar (the module/lesson
  // outline, attached the same way the CRM's sidebar is) via its own
  // SidebarProvider — stacking this top bar on top of that would just be a
  // second, competing piece of chrome. It renders its own header (back
  // link, progress, account/logout) instead.
  if (isCoursePlayer) {
    return (
      <div className="min-h-screen bg-background">
        {warning && lockState.kind === "warning" && (
          <div className="px-4 pt-4 lg:px-8">
            <MembershipWarningBanner daysUntilBlocked={lockState.daysUntilBlocked} />
          </div>
        )}
        {children}
      </div>
    );
  }

  const shell = (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-40 border-b border-border bg-card/95 backdrop-blur">
        <div className="flex items-center justify-between px-4 py-3 lg:px-8">
          <div className="flex items-center gap-6">
            <Brand />
            <nav className="hidden items-center gap-1 sm:flex">
              {LINKS.map(({ href, label, exact }) => (
                <Link
                  key={href}
                  href={href}
                  className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                    isActive(pathname, href, exact)
                      ? "bg-primary/10 text-primary"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {label}
                </Link>
              ))}
            </nav>
          </div>
          <div className="flex items-center gap-3 text-xs text-muted-foreground sm:gap-4">
            <span className="hidden text-foreground sm:inline">{firstName}</span>
            <Link
              href={ACCOUNT_LINK.href}
              className={`inline-flex items-center gap-1 hover:text-foreground ${
                isActive(pathname, ACCOUNT_LINK.href, ACCOUNT_LINK.exact) ? "text-primary" : ""
              }`}
            >
              <User className="size-3.5" aria-hidden />
              <span className="hidden sm:inline">{ACCOUNT_LINK.label}</span>
            </Link>
            <button
              type="button"
              onClick={() => signOut({ callbackUrl: "/acceso" })}
              className="inline-flex items-center gap-1 hover:text-foreground"
            >
              <LogOut className="size-3.5" aria-hidden />
              <span className="hidden sm:inline">Salir</span>
            </button>
          </div>
        </div>
        <nav aria-label="Portal" className="flex gap-1 overflow-x-auto px-3 pb-2 sm:hidden">
          {LINKS.map(({ href, label, exact }) => (
            <Link
              key={href}
              href={href}
              className={`rounded-full px-3.5 py-1.5 text-[10px] whitespace-nowrap uppercase ${
                isActive(pathname, href, exact)
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground"
              }`}
            >
              {label}
            </Link>
          ))}
        </nav>
      </header>

      <main className="px-4 pt-6 pb-16 lg:px-8 lg:pt-8">
        <div className={`mx-auto w-full ${contentMaxWidth}`}>
          {warning && lockState.kind === "warning" && (
            <MembershipWarningBanner daysUntilBlocked={lockState.daysUntilBlocked} />
          )}
          {children}
        </div>
      </main>
    </div>
  );

  if (blocked && lockState.kind === "blocked") {
    return <MembershipBlockScreen neverPaid={lockState.neverPaid}>{shell}</MembershipBlockScreen>;
  }

  return shell;
};

export default PortalSidebar;
