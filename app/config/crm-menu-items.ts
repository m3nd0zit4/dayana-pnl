import {
  BookOpen,
  CalendarDays,
  CreditCard,
  ExternalLink,
  GraduationCap,
  HeartPulse,
  ClipboardList,
  MessageSquare,
  Package,
  Users,
  UsersRound,
  Video,
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

/** Sin «Inicio»: el logo del sidebar lleva a /admin. */
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
          { icon: Video, label: "Clases", href: "/admin/curso/clases" },
          { icon: BookOpen, label: "Módulos", href: "/admin/curso/modulos" },
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
      { icon: Package, label: "Productos", href: "/admin/products" },
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
