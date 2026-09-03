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
  Link2,
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
  /**
   * Marcar como activo sólo con la ruta exacta, no con sus descendientes.
   *
   * Hace falta cuando una entrada es prefijo de otra: «Miembros» es
   * `/admin/curso` y los módulos cuelgan de `/admin/curso/…`, así que sin esto
   * las dos se encienden a la vez.
   */
  exact?: boolean;
  /** One level of nesting only (sidebar sub-items). */
  items?: Omit<CrmMenuItem, "items">[];
};

export type CrmMenuSection = {
  title: string;
  items: CrmMenuItem[];
};

/** Standalone item rendered above every section, no group label — the logo lives in the top bar now, not the sidebar, so this is the only "go home" link. */
export const crmHomeItem: CrmMenuItem = { icon: Home, label: "Inicio", href: "/admin" };

/**
 * Los grupos siguen lo que se hace cada día, no cómo está organizada la base
 * de datos.
 *
 * Antes había una sección «Clientes» con seis entradas de las que sólo una eran
 * clientes: dentro convivían el diagnóstico, los cursos, las terapias, los
 * pagos y los enlaces de pago. Cada cosa nueva se había colgado donde cabía, y
 * el resultado mezclaba personas, dinero y entrega en el mismo cajón.
 *
 * Ahora: **Ventas** es el recorrido del dinero de principio a fin —de dónde
 * sale un interesado hasta que paga—, **Personas** es quién es quién, y
 * **Sesiones y clases** es todo lo que hay que impartir. El catálogo queda para
 * lo que se configura una vez y casi no se toca.
 */
export const crmMenuSections: CrmMenuSection[] = [
  {
    // El diagnóstico es la puerta de entrada y el enlace de pago el empujón
    // final: van con Pagos porque son el mismo recorrido, y estaban repartidos.
    title: "Ventas",
    items: [
      { icon: Compass, label: "Diagnósticos", href: "/admin/diagnosticos" },
      { icon: Link2, label: "Enlaces de pago", href: "/admin/enlaces-pago" },
      { icon: CreditCard, label: "Pagos", href: "/admin/payments" },
    ],
  },
  {
    title: "Personas",
    items: [
      { icon: Users, label: "Contactos", href: "/admin/contacts" },
      // Sale del submenú de Cursos: es la lista de quién tiene acceso, que es
      // una pregunta sobre personas y no sobre el contenido del curso.
      { icon: UsersRound, label: "Miembros", href: "/admin/curso", exact: true },
    ],
  },
  {
    title: "Sesiones y clases",
    items: [
      { icon: HeartPulse, label: "Terapias", href: "/admin/therapies" },
      {
        icon: GraduationCap,
        label: "Cursos",
        href: "/admin/curso/modulos",
        items: [
          { icon: BookOpen, label: "Módulos", href: "/admin/curso/modulos" },
          { icon: MessageCircle, label: "Comentarios", href: "/admin/curso/comentarios" },
        ],
      },
      // Talleres y webinar estaban en «Catálogo», junto a los precios. Se
      // imparten, así que su sitio es este.
      { icon: CalendarDays, label: "Talleres", href: "/admin/workshops" },
      { icon: Video, label: "Webinar gratuito", href: "/admin/webinar" },
    ],
  },
  {
    // Lo que se configura una vez y casi no se vuelve a tocar.
    title: "Catálogo",
    items: [
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
