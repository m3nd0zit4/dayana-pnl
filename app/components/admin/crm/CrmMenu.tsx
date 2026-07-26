"use client";

import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { crmHomeItem, crmMenuSections, type CrmMenuItem } from "@/app/config/crm-menu-items";
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

const isActive = (pathname: string, href: string) => {
  if (href === "/") return false;
  if (href === "/admin") return pathname === "/admin";
  return pathname === href || pathname.startsWith(`${href}/`);
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
  const childActive = children.some((c) => isActive(pathname, c.href));

  // Auto-expand when landing on a child route; otherwise follow whatever
  // the user last toggled.
  const [open, setOpen] = useState(childActive);
  const [trackedPathname, setTrackedPathname] = useState(pathname);
  if (pathname !== trackedPathname) {
    setTrackedPathname(pathname);
    if (childActive) setOpen(true);
  }

  if (children.length === 0) {
    const active = isActive(pathname, item.href);
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
                <SidebarMenuSubItem key={child.href}>
                  <SidebarMenuSubButton
                    isActive={isActive(pathname, child.href)}
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

const CrmMenu = ({ onNavigate }: Props) => {
  const pathname = usePathname();
  // `canManageTeam` ya viene resuelto en el contexto (OWNER). Se usa para no
  // pintar enlaces que la propia ruta va a rebotar: `/admin/ajustes` redirige
  // a `/admin` si el rol no es OWNER, y un enlace que rebota confunde más de
  // lo que ayuda.
  const { canManageTeam } = useCrm();

  const sections = crmMenuSections
    .map((section) => ({
      ...section,
      items: section.items.filter((item) => !item.ownerOnly || canManageTeam),
    }))
    // Una sección que se queda sin elementos no debe dejar su encabezado suelto.
    .filter((section) => section.items.length > 0);

  return (
    <>
      <SidebarGroup>
        <SidebarGroupContent>
          <SidebarMenuRoot>
            <CrmMenuParentItem item={crmHomeItem} pathname={pathname} onNavigate={onNavigate} />
          </SidebarMenuRoot>
        </SidebarGroupContent>
      </SidebarGroup>

      {sections.map((section) => (
        <SidebarGroup key={section.title}>
          <SidebarGroupLabel>{section.title}</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenuRoot>
              {section.items.map((item) => (
                <CrmMenuParentItem
                  key={item.href}
                  item={item}
                  pathname={pathname}
                  onNavigate={onNavigate}
                />
              ))}
            </SidebarMenuRoot>
          </SidebarGroupContent>
        </SidebarGroup>
      ))}
    </>
  );
};

export default CrmMenu;
