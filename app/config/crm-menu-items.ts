import {
  BookOpen,
  CalendarDays,
  Clapperboard,
  CreditCard,
  ExternalLink,
  Inbox,
  GraduationCap,
  HeartPulse,
  Home,
  ClipboardList,
  Compass,
  Bell,
  MessageCircle,
  MessageSquare,
  Package,
  Tag,
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
  /**
   * Solo se muestra a quien puede administrar el equipo (OWNER).
   *
   * El filtrado lo hace `CrmMenu`. Es cosmético: cada ruta y cada endpoint
   * vuelve a exigir el rol por su cuenta. Está aquí para no pintar un enlace
   * que lleva a un rebote — un enlace visible que da 403 es peor que ninguno.
   */
  ownerOnly?: boolean;
  /**
   * Solo se muestra si la función correspondiente está encendida.
   *
   * Las páginas detrás de un interruptor hacen `notFound()` cuando está
   * apagado, así que pintar el enlace sin comprobarlo llevaría a un 404 — el
   * mismo problema que `ownerOnly` evita con los 403.
   */
  flag?: "metaInbox" | "socialPublishing";
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
      { icon: Compass, label: "Diagnósticos", href: "/admin/diagnosticos" },
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
      { icon: Video, label: "Webinar gratuito", href: "/admin/webinar" },
      { icon: Package, label: "Paquetes", href: "/admin/products" },
      { icon: Tag, label: "Códigos promocionales", href: "/admin/promo-codes" },
    ],
  },
  {
    title: "Comunicación",
    items: [
      {
        icon: Inbox,
        label: "Bandeja de entrada",
        href: "/admin/inbox",
        flag: "metaInbox",
      },
      { icon: Bell, label: "Notificaciones", href: "/admin/notificaciones" },
      { icon: MessageSquare, label: "Mensajes rápidos", href: "/admin/messages" },
      {
        icon: Clapperboard,
        label: "Contenido",
        href: "/admin/contenido",
        flag: "socialPublishing",
      },
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
      // "Ajustes" no va aquí: vive en el pie de la barra lateral, un único
      // botón para toda la configuración. Tenerlo en los dos sitios era
      // justo la duplicación que había que quitar.
      {
        icon: ExternalLink,
        label: "Web pública",
        href: "/",
        external: true,
      },
    ],
  },
];
