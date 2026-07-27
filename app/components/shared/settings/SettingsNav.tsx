"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Button } from "@/app/components/ui/button";

export type SettingsNavItem = {
  href: string;
  label: string;
};

export type SettingsNavGroup = {
  /**
   * Encabezado del grupo. Es opcional a propósito: el modal de «Mi cuenta»
   * pinta un único grupo y ahí un título sobraría.
   */
  label?: string;
  items: SettingsNavItem[];
};

/**
 * Navegación lateral de `/admin/ajustes`, agrupada.
 *
 * Quien decide qué grupos llegan aquí es el layout, que ya resolvió la sesión:
 * un rol que no es OWNER no recibe los grupos del sitio, así que no se pinta un
 * enlace que la propia ruta va a rebotar.
 */
const SettingsNav = ({ groups }: { groups: SettingsNavGroup[] }) => {
  const pathname = usePathname();

  return (
    <nav className="flex gap-4 overflow-x-auto sm:flex-col sm:gap-5 sm:overflow-visible">
      {groups.map((group, index) => (
        <div
          key={group.label ?? `grupo-${index}`}
          className="flex shrink-0 gap-1 sm:flex-col sm:gap-0.5"
        >
          {group.label && (
            <p className="hidden px-2 pb-1 text-[11px] font-medium tracking-wide text-muted-foreground uppercase sm:block">
              {group.label}
            </p>
          )}
          {group.items.map((item) => {
            const active = pathname === item.href;
            return (
              <Button
                key={item.href}
                variant={active ? "secondary" : "ghost"}
                size="sm"
                nativeButton={false}
                className="shrink-0 justify-start whitespace-nowrap sm:w-full"
                render={<Link href={item.href} replace />}
              >
                {item.label}
              </Button>
            );
          })}
        </div>
      ))}
    </nav>
  );
};

export default SettingsNav;
