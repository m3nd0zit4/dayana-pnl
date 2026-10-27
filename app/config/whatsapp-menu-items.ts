import {
  Activity,
  CalendarDays,
  FileText,
  Inbox,
  MessageCircle,
  Send,
  Settings2,
  Sparkles,
  Users,
  UsersRound,
  type LucideIcon,
} from "lucide-react";

/**
 * El menú lateral de la sección de WhatsApp: una sola lista, como la del CRM.
 *
 * Tenía nueve filas sueltas y solo tres se usan a diario (Chats, Personas,
 * Agenda). Lo demás es difusión, seguimiento de la IA o configuración, así que
 * va agrupado en submenús que se abren solos cuando la página actual es suya:
 *
 * - **Envíos**: el historial y las comunidades (las dos son difusión).
 * - **Asistente IA**: cómo le va (Estado) y hablar con ella.
 * - **Ajustes**: los ajustes de WhatsApp y las plantillas de Meta, que son
 *   configuración y estaban como una fila más.
 *
 * Ninguna ruta cambia: es solo cómo se agrupan. Los avisos del código y la app
 * instalada en el teléfono dependen de `/admin/whatsapp`.
 */

export type WhatsAppMenuItem = {
  id: string;
  icon: LucideIcon;
  label: string;
  href: string;
  /** Activo solo con la ruta exacta (Chats es prefijo de todas las demás). */
  exact?: boolean;
  /** Solo para quien administra el equipo (OWNER). Cosmético: la ruta lo vuelve a exigir. */
  ownerOnly?: boolean;
  /** Solo si el interruptor de la bandeja de Meta está encendido. */
  flag?: "metaInbox";
  /** Un nivel de submenú, como en el resto del panel. */
  items?: Omit<WhatsAppMenuItem, "items">[];
};

export const whatsAppMenuItems: WhatsAppMenuItem[] = [
  { id: "chats", icon: MessageCircle, label: "Chats", href: "/admin/whatsapp", exact: true },
  { id: "people", icon: Users, label: "Personas", href: "/admin/whatsapp/personas" },
  { id: "agenda", icon: CalendarDays, label: "Agenda", href: "/admin/whatsapp/agenda" },
  // Instagram y Messenger llegan por el mismo webhook de Meta y se atienden
  // igual que WhatsApp: viven aquí, no en «Herramientas».
  {
    id: "social-inbox",
    icon: Inbox,
    label: "Instagram y Messenger",
    href: "/admin/inbox",
    flag: "metaInbox",
  },
  {
    id: "sends",
    icon: Send,
    label: "Envíos",
    href: "/admin/whatsapp/envios",
    items: [
      { id: "sends-history", icon: Send, label: "Historial", href: "/admin/whatsapp/envios" },
      { id: "communities", icon: UsersRound, label: "Comunidades", href: "/admin/whatsapp/comunidades" },
    ],
  },
  {
    id: "assistant",
    icon: Sparkles,
    label: "Asistente IA",
    href: "/admin/whatsapp/estado",
    items: [
      { id: "status", icon: Activity, label: "Estado de la IA", href: "/admin/whatsapp/estado" },
      { id: "talk", icon: Sparkles, label: "Hablar con la IA", href: "/admin/whatsapp/asistente", ownerOnly: true },
    ],
  },
  {
    id: "settings",
    icon: Settings2,
    label: "Ajustes",
    href: "/admin/whatsapp/ajustes",
    items: [
      {
        id: "settings-general",
        icon: Settings2,
        // Corto a propósito: en un submenú caben ~15 letras antes de cortarse.
        label: "Configuración",
        href: "/admin/whatsapp/ajustes",
        ownerOnly: true,
      },
      // Quien no administra el equipo las ve (solo lectura), como antes.
      { id: "templates", icon: FileText, label: "Plantillas", href: "/admin/whatsapp/plantillas" },
    ],
  },
];

/**
 * Lo que ve cada quien: se quita lo de OWNER y lo que depende de un interruptor
 * apagado (un enlace que rebota confunde más de lo que ayuda), y un submenú que
 * se queda con una sola entrada pasa a ser esa entrada.
 */
export const visibleWhatsAppMenu = (
  items: WhatsAppMenuItem[],
  { isOwner, metaInboxEnabled }: { isOwner: boolean; metaInboxEnabled: boolean }
): WhatsAppMenuItem[] => {
  const allowed = (item: Omit<WhatsAppMenuItem, "items">) =>
    (!item.ownerOnly || isOwner) && (item.flag !== "metaInbox" || metaInboxEnabled);

  const out: WhatsAppMenuItem[] = [];
  for (const item of items) {
    if (!allowed(item)) continue;
    if (!item.items) {
      out.push(item);
      continue;
    }
    const kids = item.items.filter(allowed);
    if (kids.length === 0) continue;
    if (kids.length === 1) {
      const only = kids[0];
      out.push({ id: only.id, icon: only.icon, label: only.label, href: only.href, exact: only.exact });
      continue;
    }
    out.push({ ...item, items: kids });
  }
  return out;
};
