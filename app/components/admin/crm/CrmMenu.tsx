"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { crmMenuSections } from "@/app/config/crm-menu-items";
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

type Props = {
  onNavigate?: () => void;
};

const isActive = (pathname: string, href: string) => {
  if (href === "/") return false;
  if (href === "/admin") return pathname === "/admin";
  return pathname === href || pathname.startsWith(`${href}/`);
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
              {section.items.map((item) => {
                const Icon = item.icon;
                const external = item.external === true;
                const children = item.items ?? [];
                const childActive = children.some((c) =>
                  isActive(pathname, c.href)
                );
                const active = isActive(pathname, item.href) || childActive;

                return (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton
                      isActive={active}
                      tooltip={item.label}
                      render={
                        <Link
                          href={item.href}
                          prefetch={external ? undefined : false}
                          onClick={onNavigate}
                          {...(external
                            ? { target: "_blank", rel: "noopener noreferrer" }
                            : {})}
                        />
                      }
                    >
                      <Icon />
                      <span>{item.label}</span>
                    </SidebarMenuButton>

                    {children.length > 0 && (
                      <SidebarMenuSub>
                        {children.map((child) => {
                          const ChildIcon = child.icon;
                          return (
                            <SidebarMenuSubItem key={child.href}>
                              <SidebarMenuSubButton
                                isActive={isActive(pathname, child.href)}
                                render={
                                  <Link
                                    href={child.href}
                                    prefetch={false}
                                    onClick={onNavigate}
                                  />
                                }
                              >
                                <ChildIcon />
                                <span>{child.label}</span>
                              </SidebarMenuSubButton>
                            </SidebarMenuSubItem>
                          );
                        })}
                      </SidebarMenuSub>
                    )}
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenuRoot>
          </SidebarGroupContent>
        </SidebarGroup>
      ))}
    </>
  );
};

export default CrmMenu;
