"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CreditCard, HeartPulse, Menu, Users } from "lucide-react";
import { useCrm } from "@/app/components/admin/crm/CrmProvider";
import { useSidebar } from "@/app/components/ui/sidebar";
import { cn } from "@/lib/utils";

/**
 * Deliberately curated 3-shortcut subset — not derived from crmMenuSections.
 * "Más" opens the full nav via the shadcn Sidebar's own mobile sheet.
 */
const tabs = [
  { href: "/admin/contacts", label: "Contactos", icon: Users },
  { href: "/admin/therapies", label: "Terapias", icon: HeartPulse },
  { href: "/admin/payments", label: "Pagos", icon: CreditCard },
] as const;

const navItemClass =
  "flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 px-0.5 py-1 text-[10px] font-medium text-muted-foreground transition-[color,transform] active:scale-95";

const CrmBottomNav = () => {
  const pathname = usePathname();
  const { setOpenMobile } = useSidebar();
  const { setAgentPanelOpen } = useCrm();

  const isActive = (href: string) =>
    pathname === href || pathname.startsWith(`${href}/`);

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-30 flex h-[calc(var(--crm-bottom-nav-h)+env(safe-area-inset-bottom,0px))] items-stretch justify-around border-t border-border bg-card/92 pb-[env(safe-area-inset-bottom,0px)] backdrop-blur-xl backdrop-saturate-150 lg:hidden"
      aria-label="Navegación principal"
    >
      {tabs.map((tab) => {
        const Icon = tab.icon;
        const active = isActive(tab.href);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            prefetch={false}
            className={cn(navItemClass, active && "font-semibold text-primary")}
            aria-current={active ? "page" : undefined}
          >
            <Icon className="size-[22px]" strokeWidth={active ? 2.25 : 1.75} />
            <span>{tab.label}</span>
          </Link>
        );
      })}
      <button
        type="button"
        className={navItemClass}
        onClick={() => {
          setAgentPanelOpen(false);
          setOpenMobile(true);
        }}
        aria-label="Más opciones"
      >
        <Menu className="size-[22px]" strokeWidth={1.75} />
        <span>Más</span>
      </button>
    </nav>
  );
};

export default CrmBottomNav;
