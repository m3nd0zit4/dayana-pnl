import {
  CalendarDays,
  CreditCard,
  ExternalLink,
  HeartPulse,
  ClipboardList,
  Layers,
  Bell,
  MessageSquare,
  Package,
  Users,
  UsersRound,
  type LucideIcon,
} from "lucide-react";

export type CrmMenuItem = {
  icon: LucideIcon;
  label: string;
  href: string;
  external?: boolean;
};

export type CrmMenuSection = {
  title: string;
  items: CrmMenuItem[];
};

/** Sin «Inicio»: el logo del sidebar lleva a /admin. */
export const crmMenuSections: CrmMenuSection[] = [
  {
    title: "Clientes",
    items: [
      { icon: Users, label: "Contactos", href: "/admin/contacts" },
      { icon: Layers, label: "Servicios", href: "/admin/services" },
      { icon: HeartPulse, label: "Terapias", href: "/admin/therapies" },
      { icon: CreditCard, label: "Pagos", href: "/admin/payments" },
    ],
  },
  {
    title: "Catálogo",
    items: [
      { icon: CalendarDays, label: "Talleres", href: "/admin/workshops" },
      { icon: Package, label: "Productos", href: "/admin/products" },
    ],
  },
  {
    title: "Comunicación",
    items: [
      { icon: MessageSquare, label: "Mensajes rápidos", href: "/admin/messages" },
      { icon: Bell, label: "Notificaciones", href: "/admin/notifications" },
    ],
  },
  {
    title: "Equipo",
    items: [
      { icon: UsersRound, label: "Staff", href: "/admin/team" },
      { icon: ClipboardList, label: "Auditoría", href: "/admin/audit" },
    ],
  },
  {
    title: "Sitio",
    items: [
      {
        icon: ExternalLink,
        label: "Web pública",
        href: "/",
        external: true,
      },
    ],
  },
];
