"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import type { MembershipLockState } from "@/lib/lms/membership";
import PortalUserMenu from "./PortalUserMenu";
import {
  MembershipBlockScreen,
  MembershipWarningBanner,
} from "./MembershipLockOverlay";

const ACCOUNT_HREF = "/miembros/cuenta";

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
  avatarUrl,
  lockState,
  children,
}: {
  firstName: string;
  avatarUrl: string | null;
  lockState: MembershipLockState;
  children: ReactNode;
}) => {
  const pathname = usePathname();
  const bypassBanner = pathname.startsWith(ACCOUNT_HREF);
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
          <Brand />
          <div className="flex items-center gap-3 text-xs text-muted-foreground sm:gap-4">
            <span className="hidden text-foreground sm:inline">{firstName}</span>
            <PortalUserMenu displayName={firstName} avatarUrl={avatarUrl} />
          </div>
        </div>
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
