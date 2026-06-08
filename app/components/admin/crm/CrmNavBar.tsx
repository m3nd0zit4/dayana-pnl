"use client";

import { ExternalLink, User } from "lucide-react";
import SmartContactSearch from "@/app/components/admin/crm/SmartContactSearch";
import AdminSignOut from "@/app/components/admin/AdminSignOut";

type Props = {
  displayName: string;
  role: string;
  preview: boolean;
};

const CrmNavBar = ({ displayName, role, preview }: Props) => {
  return (
    <header className="crm-navbar sticky top-0 z-10 flex w-full items-center gap-3 px-4 py-3 backdrop-blur-xl backdrop-saturate-150 sm:gap-4 sm:px-5 md:px-6">
      {!preview ? (
        <SmartContactSearch compact placeholder="Buscar contactos…" />
      ) : (
        <div className="min-w-0 flex-1" />
      )}

      <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
        <a
          href="/"
          target="_blank"
          rel="noopener noreferrer"
          className="crm-btn-icon size-9 text-[var(--crm-muted)] hover:text-[var(--crm-foreground)]"
          aria-label="Abrir sitio público"
        >
          <ExternalLink className="size-[18px]" strokeWidth={1.75} />
        </a>

        <div className="mx-1 hidden h-6 w-px bg-black/[0.08] sm:block" aria-hidden />

        <div className="flex items-center gap-2 sm:gap-3">
          <div className="hidden min-w-0 text-right sm:block">
            <p className="truncate text-[13px] font-semibold leading-tight text-[var(--crm-foreground)]">
              {displayName}
            </p>
            <p className="text-[11px] leading-tight text-[var(--crm-muted)]">{role}</p>
          </div>
          <div
            className="crm-btn-icon size-9 text-[var(--crm-muted)]"
            aria-hidden
          >
            <User className="size-[18px]" strokeWidth={1.75} />
          </div>
          {!preview && <AdminSignOut />}
        </div>
      </div>
    </header>
  );
};

export default CrmNavBar;
