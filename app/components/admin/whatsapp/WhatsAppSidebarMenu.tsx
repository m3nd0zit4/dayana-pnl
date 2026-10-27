"use client";

import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { CrmMenuParentItem } from "@/app/components/admin/crm/CrmMenu";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/app/components/ui/sidebar";
import { visibleWhatsAppMenu, whatsAppMenuItems } from "@/app/config/whatsapp-menu-items";
import { useCrm } from "../crm/CrmProvider";
import { useWhatsAppLive } from "./live";

/**
 * El menú lateral de la sección de WhatsApp. Reemplaza al del CRM mientras se
 * está dentro de `/admin/whatsapp`: aquí todo es WhatsApp y el resto del CRM
 * queda a un clic con «Volver al CRM».
 *
 * Las filas salen de `app/config/whatsapp-menu-items.ts` y se pintan con la
 * misma pieza que el menú del CRM, así que se agrupan y se abren igual.
 */

/**
 * Rutas en las que el menú del CRM se cambia por el de WhatsApp: toda la
 * sección y la bandeja de Instagram y Messenger, que viven aquí aunque su ruta
 * sea `/admin/inbox`.
 */
export const isWhatsAppWorkspacePath = (pathname: string) =>
  pathname === "/admin/whatsapp" ||
  pathname.startsWith("/admin/whatsapp/") ||
  pathname === "/admin/inbox" ||
  pathname.startsWith("/admin/inbox/");

const WhatsAppSidebarMenu = ({ onNavigate }: { onNavigate?: () => void }) => {
  const pathname = usePathname();
  const { role, metaInboxEnabled } = useCrm();
  const [waiting, setWaiting] = useState(0);

  // El número de «Te toca» en el menú, al día con el stream de la sección.
  // Solo los números: la lista la carga la pantalla de chats.
  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/whatsapp/chats?countsOnly=1", { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as { counts: { attention: number } };
      setWaiting(data.counts.attention);
    } catch {
      // sin red: se queda el último número
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  useWhatsAppLive(load);

  const items = useMemo(
    () =>
      visibleWhatsAppMenu(whatsAppMenuItems, {
        isOwner: role === "OWNER" || role === "PREVIEW",
        metaInboxEnabled,
      }),
    [role, metaInboxEnabled]
  );

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
        <SidebarGroupLabel className="text-success">WhatsApp</SidebarGroupLabel>
        <SidebarGroupContent>
          <SidebarMenu>
            {items.map((item) => (
              <CrmMenuParentItem
                key={item.id}
                item={item}
                pathname={pathname}
                onNavigate={onNavigate}
                badge={
                  item.id === "chats"
                    ? { count: waiting, title: `${waiting} ${waiting === 1 ? "te espera" : "te esperan"}` }
                    : undefined
                }
              />
            ))}
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>
    </>
  );
};

export default WhatsAppSidebarMenu;
