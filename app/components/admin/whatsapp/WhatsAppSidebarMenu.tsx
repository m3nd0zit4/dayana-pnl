"use client";

import {
  Activity,
  ArrowLeft,
  CalendarDays,
  MessageCircle,
  Settings2,
  Sparkles,
  Users,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/app/components/ui/sidebar";
import { isCrmPathActive } from "@/app/config/crm-menu-items";
import { useCrm } from "../crm/CrmProvider";
import { useWhatsAppLive } from "./live";

/**
 * El menú lateral de la sección de WhatsApp. Reemplaza al del CRM mientras se
 * está dentro de `/admin/whatsapp`: aquí todo es WhatsApp y el resto del CRM
 * queda a un clic con «Volver al CRM».
 */

const ITEMS = [
  { href: "/admin/whatsapp", label: "Chats", icon: MessageCircle, exact: true },
  { href: "/admin/whatsapp/estado", label: "Estado de la IA", icon: Activity },
  { href: "/admin/whatsapp/personas", label: "Personas", icon: Users },
  { href: "/admin/whatsapp/agenda", label: "Agenda", icon: CalendarDays },
  { href: "/admin/whatsapp/asistente", label: "Hablar con la IA", icon: Sparkles, ownerOnly: true },
  { href: "/admin/whatsapp/ajustes", label: "Ajustes", icon: Settings2, ownerOnly: true },
] as const;

export const isWhatsAppWorkspacePath = (pathname: string) =>
  pathname === "/admin/whatsapp" || pathname.startsWith("/admin/whatsapp/");

const WhatsAppSidebarMenu = ({ onNavigate }: { onNavigate?: () => void }) => {
  const pathname = usePathname();
  const { role } = useCrm();
  const [attention, setAttention] = useState(0);

  // El número de «Te toca» en el menú, al día con el stream de la sección.
  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/whatsapp/chats?queue=attention", { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as { counts: { attention: number } };
      setAttention(data.counts.attention);
    } catch {
      // sin red: se queda el último número
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  useWhatsAppLive(load);

  return (
    <>
      <SidebarGroup>
        <SidebarGroupContent>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton render={<Link href="/admin" onClick={onNavigate} />}>
                <ArrowLeft />
                <span>Volver al CRM</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>
      <SidebarGroup>
        <SidebarGroupLabel className="text-[#128c4a]">WhatsApp</SidebarGroupLabel>
        <SidebarGroupContent>
          <SidebarMenu>
            {ITEMS.filter((i) => !("ownerOnly" in i && i.ownerOnly) || role === "OWNER" || role === "PREVIEW").map(
              (item) => {
                const Icon = item.icon;
                const active = isCrmPathActive(pathname, item.href, "exact" in item ? item.exact : false);
                return (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton
                      isActive={active}
                      tooltip={item.label}
                      render={<Link href={item.href} prefetch={false} onClick={onNavigate} />}
                    >
                      <Icon />
                      <span>{item.label}</span>
                    </SidebarMenuButton>
                    {item.href === "/admin/whatsapp" && attention > 0 && (
                      <SidebarMenuBadge className="bg-[#00a884] text-white">{attention}</SidebarMenuBadge>
                    )}
                  </SidebarMenuItem>
                );
              }
            )}
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>
    </>
  );
};

export default WhatsAppSidebarMenu;
