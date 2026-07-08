"use client";

import { ExternalLink } from "lucide-react";
import SmartContactSearch from "@/app/components/admin/crm/SmartContactSearch";
import AdminSignOut from "@/app/components/admin/AdminSignOut";
import { Button } from "@/app/components/ui/button";
import { Separator } from "@/app/components/ui/separator";

type Props = {
  displayName: string;
  role: string;
  preview: boolean;
};

const CrmNavBar = ({ displayName, role, preview }: Props) => (
  <header className="sticky top-0 z-20 flex w-full shrink-0 items-center gap-2 border-b border-border bg-background/95 px-3 py-2.5 backdrop-blur-xl backdrop-saturate-150 sm:gap-3 sm:px-4 lg:px-5">
    {!preview ? (
      <SmartContactSearch compact placeholder="Buscar…" />
    ) : (
      <div className="min-w-0 flex-1" />
    )}

    <div className="flex shrink-0 items-center gap-1 sm:gap-1.5">
      <Button
        variant="ghost"
        size="icon"
        className="text-muted-foreground hover:text-foreground"
        aria-label="Abrir sitio público"
        nativeButton={false}
        render={<a href="/" target="_blank" rel="noopener noreferrer" />}
      >
        <ExternalLink />
      </Button>

      <Separator orientation="vertical" className="mx-0.5 hidden h-6 md:block" />

      <div className="hidden min-w-0 max-w-[8rem] text-right md:block lg:max-w-[10rem]">
        <p className="truncate text-[13px] leading-tight font-semibold">
          {displayName}
        </p>
        <p className="truncate text-[11px] leading-tight text-muted-foreground">
          {role}
        </p>
      </div>

      {!preview && <AdminSignOut />}
    </div>
  </header>
);

export default CrmNavBar;
