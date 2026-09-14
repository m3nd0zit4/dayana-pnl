"use client";

import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  crmHomeItem,
  crmMenuSections,
  crmStatsItem,
  isCrmPathActive,
  type CrmMenuItem,
  type CrmMenuSection,
} from "@/app/config/crm-menu-items";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/app/components/ui/collapsible";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu as SidebarMenuRoot,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from "@/app/components/ui/sidebar";
import { useCrm } from "./CrmProvider";

type Props = {
  onNavigate?: () => void;
};

const itemIsActive = (pathname: string, item: CrmMenuItem): boolean =>
  isCrmPathActive(pathname, item.href, item.exact) ||
  (item.items ?? []).some((c) => isCrmPathActive(pathname, c.href, c.exact));

/**
 * Abierto al llegar a una ruta suya; si no, lo último que se tocó. Compartido
 * por las entradas con hijos y por los grupos plegables.
 */
const useOpenWhenActive = (pathname: string, active: boolean) => {
  const [open, setOpen] = useState(active);
  const [trackedPathname, setTrackedPathname] = useState(pathname);
  if (pathname !== trackedPathname) {
    setTrackedPathname(pathname);
    if (active) setOpen(true);
  }
  return [open, setOpen] as const;
};

const CrmMenuParentItem = ({
  item,
  pathname,
  onNavigate,
}: {
  item: CrmMenuItem;
  pathname: string;
  onNavigate?: () => void;
}) => {
  const Icon = item.icon;
  const external = item.external === true;
  const children = item.items ?? [];
  const childActive = children.some((c) => isCrmPathActive(pathname, c.href, c.exact));
  const [open, setOpen] = useOpenWhenActive(pathname, childActive);

  if (children.length === 0) {
    const active = isCrmPathActive(pathname, item.href, item.exact);
    return (
      <SidebarMenuItem>
        <SidebarMenuButton
          isActive={active}
          tooltip={item.label}
          render={
            <Link
              href={item.href}
              prefetch={external ? undefined : false}
              onClick={onNavigate}
              {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
            />
          }
        >
          <Icon />
          <span>{item.label}</span>
        </SidebarMenuButton>
      </SidebarMenuItem>
    );
  }

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <SidebarMenuItem>
        <CollapsibleTrigger
          render={
            <SidebarMenuButton isActive={childActive} tooltip={item.label} />
          }
        >
          <Icon />
          <span>{item.label}</span>
          <ChevronRight
            className={`ml-auto transition-transform duration-200 ${open ? "rotate-90" : ""}`}
          />
        </CollapsibleTrigger>
        <CollapsibleContent>
          <SidebarMenuSub>
            {children.map((child) => {
              const ChildIcon = child.icon;
              return (
                <SidebarMenuSubItem key={child.id}>
                  <SidebarMenuSubButton
                    isActive={isCrmPathActive(pathname, child.href, child.exact)}
                    render={
                      <Link href={child.href} prefetch={false} onClick={onNavigate} />
                    }
                  >
                    <ChildIcon />
                    <span>{child.label}</span>
                  </SidebarMenuSubButton>
                </SidebarMenuSubItem>
              );
            })}
          </SidebarMenuSub>
        </CollapsibleContent>
      </SidebarMenuItem>
    </Collapsible>
  );
};

const SectionItems = ({
  section,
  pathname,
  onNavigate,
}: {
  section: CrmMenuSection;
  pathname: string;
  onNavigate?: () => void;
}) => (
  <SidebarGroupContent>
    <SidebarMenuRoot>
      {section.items.map((item) => (
        <CrmMenuParentItem
          key={item.id}
          item={item}
          pathname={pathname}
          onNavigate={onNavigate}
        />
      ))}
    </SidebarMenuRoot>
  </SidebarGroupContent>
);

/**
 * Grupo plegado («Herramientas»): lo que casi no se usa, a un toque pero sin
 * ocupar la lista diaria. Se abre solo cuando la página actual es suya, para
 * que la entrada activa nunca quede escondida.
 */
const CollapsibleSection = ({
  section,
  pathname,
  onNavigate,
}: {
  section: CrmMenuSection;
  pathname: string;
  onNavigate?: () => void;
}) => {
  const active = section.items.some((item) => itemIsActive(pathname, item));
  const [open, setOpen] = useOpenWhenActive(pathname, active);

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <SidebarGroup>
        <SidebarGroupLabel
          render={<CollapsibleTrigger />}
          className="w-full cursor-pointer hover:text-sidebar-foreground"
        >
          {section.title}
          <ChevronRight
            aria-hidden
            className={`ml-auto transition-transform duration-200 ${open ? "rotate-90" : ""}`}
          />
        </SidebarGroupLabel>
        <CollapsibleContent>
          <SectionItems section={section} pathname={pathname} onNavigate={onNavigate} />
        </CollapsibleContent>
      </SidebarGroup>
    </Collapsible>
  );
};

const CrmMenu = ({ onNavigate }: Props) => {
  const pathname = usePathname();
  // `canManageTeam` ya viene resuelto en el contexto (OWNER). Se usa para no
  // pintar enlaces que la propia ruta va a rebotar: un enlace visible que da
  // 403 confunde más de lo que ayuda.
  const { canManageTeam, metaInboxEnabled, socialPublishingEnabled } = useCrm();

  // Mismo motivo que `ownerOnly`, con 404 en vez de 403: las páginas detrás de
  // un interruptor hacen `notFound()` cuando está apagado.
  const flagEnabled = (flag: CrmMenuItem["flag"]): boolean => {
    if (!flag) return true;
    return flag === "metaInbox" ? metaInboxEnabled : socialPublishingEnabled;
  };

  const sections = crmMenuSections
    .map((section) => ({
      ...section,
      items: section.items.filter(
        (item) => (!item.ownerOnly || canManageTeam) && flagEnabled(item.flag)
      ),
    }))
    // Una sección que se queda sin elementos no debe dejar su encabezado suelto.
    .filter((section) => section.items.length > 0);

  return (
    <>
      <SidebarGroup>
        <SidebarGroupContent>
          <SidebarMenuRoot>
            <CrmMenuParentItem item={crmHomeItem} pathname={pathname} onNavigate={onNavigate} />
            {canManageTeam ? (
              <CrmMenuParentItem item={crmStatsItem} pathname={pathname} onNavigate={onNavigate} />
            ) : null}
          </SidebarMenuRoot>
        </SidebarGroupContent>
      </SidebarGroup>

      {sections.map((section) =>
        section.collapsible ? (
          <CollapsibleSection
            key={section.id}
            section={section}
            pathname={pathname}
            onNavigate={onNavigate}
          />
        ) : (
          <SidebarGroup key={section.id}>
            <SidebarGroupLabel>{section.title}</SidebarGroupLabel>
            <SectionItems section={section} pathname={pathname} onNavigate={onNavigate} />
          </SidebarGroup>
        )
      )}
    </>
  );
};

export default CrmMenu;
