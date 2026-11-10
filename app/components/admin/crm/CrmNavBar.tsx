"use client";

import { ExternalLink } from "lucide-react";
import { usePathname } from "next/navigation";
import CrmLogo from "@/app/components/admin/crm/CrmLogo";
import CrmNotificationBell from "@/app/components/admin/crm/CrmNotificationBell";
import SmartContactSearch from "@/app/components/admin/crm/SmartContactSearch";
import CrmUserMenu from "@/app/components/admin/crm/CrmUserMenu";
import { Button } from "@/app/components/ui/button";
import { Separator } from "@/app/components/ui/separator";

type Props = {
  displayName: string;
  role: string;
  avatarUrl: string | null;
  preview: boolean;
};

const iconButtonClass =
  "text-[var(--crm-topbar-foreground)]/70 hover:bg-[var(--crm-topbar-accent)] hover:text-[var(--crm-topbar-foreground)]";

const CrmNavBar = ({ displayName, role, avatarUrl, preview }: Props) => {
  const pathname = usePathname();
  // En Contactos la búsqueda de la página es la misma búsqueda, con recientes y
  // salto directo a la ficha. Dos cajas iguales en la misma pantalla obligaban
  // a decidir en cuál escribir.
  const showTopSearch = !preview && pathname !== "/admin/contacts";

  return (
    <header className="sticky top-0 z-30 flex h-14 w-full shrink-0 items-center gap-4 bg-[var(--crm-topbar)] px-3 text-[var(--crm-topbar-foreground)] sm:px-4 lg:px-5">
      {/* Sin botón de menú en el móvil: «Más», en la barra inferior, abre el
          mismo menú. Tener los dos era el mismo botón dos veces. */}
      <CrmLogo />

      <div className="mx-auto hidden min-w-0 w-full max-w-xl lg:block">{showTopSearch && <SmartContactSearch compact placeholder="Buscar…" />}</div>
      <div className="flex-1 lg:hidden" />

      <div className="flex shrink-0 items-center gap-1 sm:gap-1.5">
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
