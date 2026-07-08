"use client";

import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import { BookOpen, Home, LogOut, User, Video } from "lucide-react";
import type { MembershipLockState } from "@/lib/lms/membership";
import { Button } from "@/app/components/ui/button";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
} from "@/app/components/ui/sidebar";
import {
  MembershipBlockScreen,
  MembershipWarningBanner,
} from "./MembershipLockOverlay";

const LINKS = [
  { href: "/miembros", label: "Inicio", icon: Home, exact: true },
  { href: "/miembros/clases", label: "Clases", icon: Video, exact: false },
  { href: "/miembros/modulos", label: "Módulos", icon: BookOpen, exact: false },
];

const ACCOUNT_LINK = {
  href: "/miembros/cuenta",
  label: "Mi cuenta",
  icon: User,
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
  const bypass = pathname === ACCOUNT_LINK.href;
  const blocked = !bypass && lockState.kind === "blocked";
  const warning = !bypass && lockState.kind === "warning";

  const shell = (
    <SidebarProvider style={{ "--sidebar-width": "15rem" } as CSSProperties}>
      <Sidebar collapsible="offcanvas" className="border-r border-border">
        <SidebarHeader className="px-3 py-5">
          <Brand />
        </SidebarHeader>
        <SidebarContent className="px-2">
          <SidebarMenu>
            {LINKS.map(({ href, label, icon: Icon, exact }) => (
              <SidebarMenuItem key={href}>
                <SidebarMenuButton
                  isActive={isActive(pathname, href, exact)}
                  render={<Link href={href} />}
                >
                  <Icon />
                  {label}
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </SidebarContent>
        <SidebarFooter className="border-t border-border px-3 py-4">
          <div className="px-1 text-xs text-muted-foreground">{firstName}</div>
          <SidebarMenu className="mt-2">
            <SidebarMenuItem>
              <SidebarMenuButton
                isActive={isActive(pathname, ACCOUNT_LINK.href, ACCOUNT_LINK.exact)}
                render={<Link href={ACCOUNT_LINK.href} />}
              >
                <ACCOUNT_LINK.icon />
                {ACCOUNT_LINK.label}
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
          <Button
            variant="ghost"
            className="mt-1 w-full justify-start"
            onClick={() => signOut({ callbackUrl: "/acceso" })}
          >
            <LogOut />
            Salir
          </Button>
        </SidebarFooter>
      </Sidebar>

      <SidebarInset className="bg-transparent">
        {/* Mobile top bar — kept as its own always-visible header (not
            Sidebar's Sheet): only 4 items, always reachable in one tap. */}
        <header className="sticky top-0 z-40 border-b border-border bg-card/95 backdrop-blur lg:hidden">
          <div className="flex items-center justify-between px-4 pt-3">
            <Brand />
            <div className="flex items-center gap-2">
              <Link
                href={ACCOUNT_LINK.href}
                aria-label={ACCOUNT_LINK.label}
                className={`rounded-full border p-2 ${
                  isActive(pathname, ACCOUNT_LINK.href, ACCOUNT_LINK.exact)
                    ? "border-primary text-primary"
                    : "border-border text-muted-foreground"
                }`}
              >
                <User className="size-4" aria-hidden />
              </Link>
              <button
                type="button"
                onClick={() => signOut({ callbackUrl: "/acceso" })}
                aria-label="Salir"
                className="rounded-full border border-border p-2 text-muted-foreground"
              >
                <LogOut className="size-4" aria-hidden />
              </button>
            </div>
          </div>
          <nav aria-label="Portal" className="flex gap-1 overflow-x-auto px-3 py-2">
            {LINKS.map(({ href, label, exact }) => {
              const active = isActive(pathname, href, exact);
              return (
                <Link
                  key={href}
                  href={href}
                  className={`rounded-full px-3.5 py-2 text-[10px] whitespace-nowrap uppercase ${
                    active ? "bg-primary text-primary-foreground" : "text-muted-foreground"
                  }`}
                >
                  {label}
                </Link>
              );
            })}
          </nav>
        </header>

        <main className="min-h-screen px-4 pt-6 pb-16 lg:px-8 lg:pt-10">
          <div className="mx-auto w-full max-w-4xl">
            {warning && lockState.kind === "warning" && (
              <MembershipWarningBanner daysUntilBlocked={lockState.daysUntilBlocked} />
            )}
            {children}
          </div>
        </main>
      </SidebarInset>
    </SidebarProvider>
  );

  if (blocked && lockState.kind === "blocked") {
    return <MembershipBlockScreen neverPaid={lockState.neverPaid}>{shell}</MembershipBlockScreen>;
  }

  return shell;
};

export default PortalSidebar;
