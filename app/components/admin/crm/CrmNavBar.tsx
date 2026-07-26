"use client";

import { ExternalLink, PanelLeft } from "lucide-react";
import { useState } from "react";
import CrmLogo from "@/app/components/admin/crm/CrmLogo";
import CrmNotificationBell from "@/app/components/admin/crm/CrmNotificationBell";
import SmartContactSearch from "@/app/components/admin/crm/SmartContactSearch";
import CrmUserMenu from "@/app/components/admin/crm/CrmUserMenu";
import { useCrm } from "@/app/components/admin/crm/CrmProvider";
import { DayanaAiLogo } from "@/app/components/admin/crm/DayanaAiLogo";
import { Button } from "@/app/components/ui/button";
import { Separator } from "@/app/components/ui/separator";
import { useSidebar } from "@/app/components/ui/sidebar";
import { cn } from "@/lib/utils";

type Props = {
  displayName: string;
  role: string;
  avatarUrl: string | null;
  preview: boolean;
};

const iconButtonClass =
  "text-[var(--crm-topbar-foreground)]/70 hover:bg-[var(--crm-topbar-accent)] hover:text-[var(--crm-topbar-foreground)]";

const CrmNavBar = ({ displayName, role, avatarUrl, preview }: Props) => {
  const { agentEnabled, agentPanelOpen, setAgentPanelOpen } = useCrm();
  const [agentButtonHovered, setAgentButtonHovered] = useState(false);
  const { setOpenMobile } = useSidebar();

  return (
    <header className="sticky top-0 z-30 flex h-14 w-full shrink-0 items-center gap-4 bg-[var(--crm-topbar)] px-3 text-[var(--crm-topbar-foreground)] sm:px-4 lg:px-5">
      <Button
        variant="ghost"
        size="icon"
        className={cn("shrink-0 lg:hidden", iconButtonClass)}
        aria-label="Abrir menú"
        onClick={() => {
          setAgentPanelOpen(false);
          setOpenMobile(true);
        }}
      >
        <PanelLeft />
      </Button>

      <CrmLogo />

      <div className="mx-auto hidden min-w-0 w-full max-w-xl lg:block">{!preview && <SmartContactSearch compact placeholder="Buscar…" />}</div>
      <div className="flex-1 lg:hidden" />

      <div className="flex shrink-0 items-center gap-1 sm:gap-1.5">
        {agentEnabled && (
          <Button
            variant={agentPanelOpen ? "secondary" : "ghost"}
            size="icon"
            className={cn("relative hidden lg:inline-flex", iconButtonClass)}
            aria-label="Asistente CRM"
            onClick={() => setAgentPanelOpen(!agentPanelOpen)}
            onMouseEnter={() => setAgentButtonHovered(true)}
            onMouseLeave={() => setAgentButtonHovered(false)}
          >
            {/* Button's own hit area stays the fixed icon size; the logo
                renders bigger and overflows it via absolute positioning. */}
            <DayanaAiLogo
              className="absolute top-1/2 left-1/2 size-11 -translate-x-1/2 -translate-y-1/2"
              active={agentButtonHovered}
            />
          </Button>
        )}

        <CrmNotificationBell className={iconButtonClass} />

        <Button
          variant="ghost"
          size="icon"
          className={iconButtonClass}
          aria-label="Abrir sitio público"
          nativeButton={false}
          render={<a href="/" target="_blank" rel="noopener noreferrer" />}
        >
          <ExternalLink />
        </Button>

        <Separator orientation="vertical" className="mx-0.5 hidden h-6 bg-[var(--crm-topbar-border)] md:block" />

        {!preview && <CrmUserMenu displayName={displayName} role={role} avatarUrl={avatarUrl} />}
      </div>
    </header>
  );
};

export default CrmNavBar;
