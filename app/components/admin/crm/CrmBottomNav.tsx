"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu } from "lucide-react";
import { useCrm } from "@/app/components/admin/crm/CrmProvider";
import { useSidebar } from "@/app/components/ui/sidebar";
import {
  CRM_BOTTOM_TABS,
  findMenuItem,
  isCrmPathActive,
  type CrmMenuItem,
} from "@/app/config/crm-menu-items";
import { cn } from "@/lib/utils";

/**
 * Tres accesos más «Más», que abre la barra lateral entera.
 *
 * Salen de `CRM_BOTTOM_TABS` en la configuración del menú, no de una lista
 * propia: así el icono, la ruta y la regla de «activo» son los mismos que en la
 * barra lateral. Es el único botón que abre el menú en el móvil — el de la
 * barra superior hacía lo mismo y se quitó.
 */
const tabs = CRM_BOTTOM_TABS.map(findMenuItem).filter(
  (item): item is CrmMenuItem => item !== undefined,
);

const navItemClass =
  "flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 px-0.5 py-1 text-[10px] font-medium text-muted-foreground transition-[color,transform] active:scale-95";

const CrmBottomNav = () => {
  const pathname = usePathname();
  const { setOpenMobile } = useSidebar();
  const { setAgentPanelOpen } = useCrm();

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-30 flex h-[calc(var(--crm-bottom-nav-h)+env(safe-area-inset-bottom,0px))] items-stretch justify-around border-t border-border bg-card/92 pb-[env(safe-area-inset-bottom,0px)] backdrop-blur-xl backdrop-saturate-150 lg:hidden"
      aria-label="Navegación principal"
    >
      {tabs.map((tab) => {
        const Icon = tab.icon;
        const active = isCrmPathActive(pathname, tab.href, tab.exact);
        return (
          <Link
            key={tab.id}
            href={tab.href}
            prefetch={false}
            className={cn(navItemClass, active && "font-semibold text-primary")}
            aria-current={active ? "page" : undefined}
          >
            <Icon className="size-[22px]" strokeWidth={active ? 2.25 : 1.75} />
            <span>{tab.shortLabel ?? tab.label}</span>
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
