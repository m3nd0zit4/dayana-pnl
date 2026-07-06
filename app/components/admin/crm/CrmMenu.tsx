"use client";

import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { crmMenuSections, type CrmMenuItem } from "@/app/config/crm-menu-items";
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
  SidebarMenuAction,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from "@/app/components/ui/sidebar";

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
  const active = isActive(pathname, item.href) || childActive;

  // Auto-expand when landing on the parent or a child route; otherwise
  // follow whatever the user last toggled.
  const [open, setOpen] = useState(childActive || active);
  const [trackedPathname, setTrackedPathname] = useState(pathname);
  if (pathname !== trackedPathname) {
    setTrackedPathname(pathname);
    if (childActive || active) setOpen(true);
  }

  const link = (
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
  );

  if (children.length === 0) {
    return <SidebarMenuItem>{link}</SidebarMenuItem>;
  }

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <SidebarMenuItem>
        {link}
        <CollapsibleTrigger
          render={
            <SidebarMenuAction aria-label={open ? "Contraer" : "Expandir"}>
              <ChevronRight
                className={`transition-transform duration-200 ${open ? "rotate-90" : ""}`}
              />
            </SidebarMenuAction>
          }
        />
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

  return (
    <>
      {crmMenuSections.map((section) => (
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
