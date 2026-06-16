"use client";

import { ExternalLink, Menu } from "lucide-react";
import SmartContactSearch from "@/app/components/admin/crm/SmartContactSearch";
import AdminSignOut from "@/app/components/admin/AdminSignOut";

type Props = {
  displayName: string;
  role: string;
  preview: boolean;
  menuOpen: boolean;
  onOpenMenu: () => void;
};

const CrmNavBar = ({
  displayName,
  role,
  preview,
  menuOpen,
  onOpenMenu,
}: Props) => (
  <header className="crm-navbar sticky top-0 z-20 flex w-full shrink-0 items-center gap-2 px-3 py-2.5 backdrop-blur-xl backdrop-saturate-150 sm:gap-3 sm:px-4 lg:px-5">
    <button
      type="button"
      className="crm-btn-icon crm-menu-trigger size-10 shrink-0 lg:hidden"
      onClick={onOpenMenu}
      aria-label={menuOpen ? "Cerrar menú" : "Abrir menú"}
      aria-expanded={menuOpen}
      aria-controls="crm-mobile-drawer"
    >
      <Menu className="size-5" strokeWidth={1.75} />
    </button>

    {!preview ? (
      <SmartContactSearch compact placeholder="Buscar…" />
    ) : (
      <div className="min-w-0 flex-1" />
    )}

    <div className="flex shrink-0 items-center gap-1 sm:gap-1.5">
      <a
        href="/"
        target="_blank"
        rel="noopener noreferrer"
        className="crm-btn-icon size-10 text-[var(--crm-muted)] hover:text-[var(--crm-foreground)]"
        aria-label="Abrir sitio público"
      >
        <ExternalLink className="size-[18px]" strokeWidth={1.75} />
      </a>

      <div
        className="mx-0.5 hidden h-6 w-px bg-[var(--crm-border)] md:block"
        aria-hidden
      />

      <div className="hidden min-w-0 max-w-[8rem] text-right md:block lg:max-w-[10rem]">
        <p className="truncate text-[13px] font-semibold leading-tight text-[var(--crm-foreground)]">
          {displayName}
        </p>
        <p className="truncate text-[11px] leading-tight text-[var(--crm-muted)]">
          {role}
        </p>
      </div>

      {!preview && <AdminSignOut />}
    </div>
  </header>
);

export default CrmNavBar;
