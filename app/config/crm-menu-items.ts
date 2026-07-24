import {
  BookOpen,
  CalendarDays,
  CreditCard,
  ExternalLink,
  GraduationCap,
  HeartPulse,
  Home,
  ClipboardList,
  MessageCircle,
  MessageSquare,
  Package,
  Tag,
  Users,
  UsersRound,
  type LucideIcon,
} from "lucide-react";

export type CrmMenuItem = {
  icon: LucideIcon;
  label: string;
  href: string;
  external?: boolean;
  /** One level of nesting only (sidebar sub-items). */
  items?: Omit<CrmMenuItem, "items">[];
};

export type CrmMenuSection = {
  title: string;
  items: CrmMenuItem[];
};

/** Standalone item rendered above every section, no group label — the logo lives in the top bar now, not the sidebar, so this is the only "go home" link. */
export const crmHomeItem: CrmMenuItem = { icon: Home, label: "Inicio", href: "/admin" };

export const crmMenuSections: CrmMenuSection[] = [
  {
    title: "Clientes",
    items: [
      { icon: Users, label: "Contactos", href: "/admin/contacts" },
      {
        icon: GraduationCap,
        label: "Curso",
        href: "/admin/curso",
        items: [
          { icon: UsersRound, label: "Miembros", href: "/admin/curso" },
          { icon: BookOpen, label: "Módulos", href: "/admin/curso/modulos" },
          { icon: MessageCircle, label: "Comentarios", href: "/admin/curso/comentarios" },
        ],
      },
      { icon: HeartPulse, label: "Terapias", href: "/admin/therapies" },
      { icon: CreditCard, label: "Pagos", href: "/admin/payments" },
    ],
  },
  {
    title: "Catálogo",
    items: [
      { icon: CalendarDays, label: "Talleres", href: "/admin/workshops" },
      { icon: Package, label: "Paquetes", href: "/admin/products" },
      { icon: Tag, label: "Códigos promocionales", href: "/admin/promo-codes" },
    ],
  },
  {
    title: "Comunicación",
    items: [
      { icon: MessageSquare, label: "Mensajes rápidos", href: "/admin/messages" },
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
