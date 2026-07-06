"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CreditCard, HeartPulse, Menu, Users } from "lucide-react";
import { useSidebar } from "@/app/components/ui/sidebar";

/**
 * Deliberately curated 3-shortcut subset — not derived from crmMenuSections.
 * "Más" opens the full nav via the shadcn Sidebar's own mobile sheet.
 */
const tabs = [
  { href: "/admin/contacts", label: "Contactos", icon: Users },
  { href: "/admin/therapies", label: "Terapias", icon: HeartPulse },
  { href: "/admin/payments", label: "Pagos", icon: CreditCard },
] as const;

const CrmBottomNav = () => {
  const pathname = usePathname();
  const { setOpenMobile } = useSidebar();

  const isActive = (href: string) =>
    pathname === href || pathname.startsWith(`${href}/`);

  return (
    <nav className="crm-bottom-nav" aria-label="Navegación principal">
      {tabs.map((tab) => {
        const Icon = tab.icon;
        const active = isActive(tab.href);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            prefetch={false}
            className={`crm-bottom-nav-item${active ? " is-active" : ""}`}
            aria-current={active ? "page" : undefined}
          >
            <Icon className="size-[22px]" strokeWidth={active ? 2.25 : 1.75} />
            <span>{tab.label}</span>
          </Link>
        );
      })}
      <button
        type="button"
        className="crm-bottom-nav-item"
        onClick={() => setOpenMobile(true)}
        aria-label="Más opciones"
      >
        <Menu className="size-[22px]" strokeWidth={1.75} />
        <span>Más</span>
      </button>
    </nav>
  );
};

export default CrmBottomNav;
