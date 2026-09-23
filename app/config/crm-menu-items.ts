import {
  BookOpen,
  CalendarDays,
  ChartColumn,
  Clapperboard,
  CreditCard,
  Inbox,
  GraduationCap,
  Home,
  Compass,
  Link2,
  MessageCircle,
  MessageSquare,
  Package,
  Sparkles,
  Tag,
  Users,
  UsersRound,
  Video,
  type LucideIcon,
} from "lucide-react";

/**
 * Identificador estable de cada entrada. La barra inferior del móvil y
 * cualquier otro sitio que necesite «la entrada de Pagos» la buscan por `id`,
 * nunca por el título: un buscador que buscaba la sección «Clientes» se quedó
 * sin atajos el día que esa sección cambió de nombre, sin que nada fallara.
 */
export type CrmMenuItemId =
  | "home"
  | "stats"
  | "payments"
  | "payment-links"
  | "products"
  | "promo-codes"
  | "contacts"
  | "memberships"
  | "diagnostics"
  | "messages"
  | "magnets"
  | "courses"
  | "modules"
  | "comments"
  | "workshops"
  | "webinar"
  | "inbox"
  | "whatsapp"
  | "content";

export type CrmMenuItem = {
  id: CrmMenuItemId;
  icon: LucideIcon;
  label: string;
  /** Etiqueta corta para la barra inferior del móvil, donde caben ~9 caracteres. */
  shortLabel?: string;
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
   * Hace falta cuando una entrada es prefijo de otra.
   */
  exact?: boolean;
  /** One level of nesting only (sidebar sub-items). */
  items?: Omit<CrmMenuItem, "items">[];
};

export type CrmMenuSection = {
  id: string;
  title: string;
  items: CrmMenuItem[];
  /**
   * Grupo plegado por defecto: lo que casi no se usa sigue a un toque, pero no
   * ocupa sitio en la lista diaria. Se abre solo si la página actual es suya.
   */
  collapsible?: boolean;
};

/** Standalone item rendered above every section, no group label — the logo lives in the top bar now, not the sidebar, so this is the only "go home" link. */
export const crmHomeItem: CrmMenuItem = {
  id: "home",
  icon: Home,
  label: "Inicio",
  href: "/admin",
};

/**
 * WhatsApp, junto a Inicio: es donde se atiende el día a día. Abre su propia
 * sección con su propio menú (chats, estado de la IA, agenda, ajustes).
 */
export const crmWhatsAppItem: CrmMenuItem = {
  id: "whatsapp",
  icon: MessageCircle,
  label: "WhatsApp",
  shortLabel: "WhatsApp",
  href: "/admin/whatsapp",
};

/**
 * Estadísticas, junto a Inicio y no dentro de ningún grupo: es la vista de
 * todo el negocio, no una tarea de un área concreta. Solo la ve quien puede
 * administrar el equipo (OWNER) — visible en Ventas, Contactos, etc. sería
 * un enlace que da 403 al resto del staff.
 */
export const crmStatsItem: CrmMenuItem = {
  id: "stats",
  icon: ChartColumn,
  label: "Estadísticas",
  href: "/admin/estadisticas",
  ownerOnly: true,
};

/**
 * El menú sigue lo que Dayana hace cada día, en ese orden.
 *
 * - **Ventas** abre con Pagos y Enlaces, que se usan a diario; Paquetes y
 *   Códigos se configuran y casi no se tocan.
 * - **Personas** es quién es quién: contactos, membresías, diagnósticos y los
 *   mensajes rápidos con los que se les escribe.
 * - **Clases** es todo lo que hay que impartir.
 * - **Herramientas** va plegado: la bandeja de Meta y la publicación en TikTok
 *   funcionan igual, pero se usan poco (decisión de Dayana, sep. 2026).
 *
 * Nada de lo que salió se perdió:
 *
 * - **Web pública** era un grupo de una sola entrada que repetía el icono de la
 *   barra superior, que está en todos los tamaños.
 * - **Ajustes** vive en el pie de la barra lateral; **Staff** y **Auditoría**,
 *   dentro de Ajustes. **Notificaciones** es el historial de la campana.
 * - **Miembros** y **Suscripciones** son **Membresías**, con una pestaña para
 *   cada una. Las rutas antiguas redirigen.
 */
export const crmMenuSections: CrmMenuSection[] = [
  {
    id: "ventas",
    title: "Ventas",
    items: [
      { id: "payments", icon: CreditCard, label: "Pagos", href: "/admin/payments" },
      { id: "payment-links", icon: Link2, label: "Enlaces de pago", href: "/admin/enlaces-pago" },
      { id: "products", icon: Package, label: "Paquetes", href: "/admin/products" },
      { id: "promo-codes", icon: Tag, label: "Códigos promocionales", href: "/admin/promo-codes" },
    ],
  },
  {
    id: "personas",
    title: "Personas",
    items: [
      { id: "contacts", icon: Users, label: "Contactos", href: "/admin/contacts" },
      { id: "memberships", icon: UsersRound, label: "Membresías", href: "/admin/membresias" },
      // El diagnóstico se mira para saber QUIÉN es quien llega y qué necesita,
      // no para cobrarle. Por eso vive con las personas y no con el dinero.
      { id: "diagnostics", icon: Compass, label: "Diagnósticos", href: "/admin/diagnosticos" },
      // Plantillas para escribirle a una persona: se usan desde su ficha.
      { id: "messages", icon: MessageSquare, label: "Mensajes rápidos", href: "/admin/messages" },
      // «Comenta ÉXITO y te mando el material»: la palabra de cada video, su
      // material y la respuesta lista para pegar. Vive con las personas
      // porque lo que produce son leads, no ventas directas.
      { id: "magnets", icon: Sparkles, label: "Palabras clave", shortLabel: "Palabras", href: "/admin/palabras-clave" },
    ],
  },
  {
    id: "clases",
    title: "Clases",
    items: [
      {
        id: "courses",
        icon: GraduationCap,
        label: "Cursos",
        href: "/admin/curso/modulos",
        items: [
          { id: "modules", icon: BookOpen, label: "Módulos", href: "/admin/curso/modulos" },
          { id: "comments", icon: MessageCircle, label: "Comentarios", href: "/admin/curso/comentarios" },
        ],
      },
      { id: "workshops", icon: CalendarDays, label: "Talleres", href: "/admin/workshops" },
      { id: "webinar", icon: Video, label: "Webinar gratuito", href: "/admin/webinar" },
    ],
  },
  {
    id: "herramientas",
    title: "Herramientas",
    collapsible: true,
    items: [
      {
        id: "inbox",
        icon: Inbox,
        label: "Bandeja de entrada",
        href: "/admin/inbox",
        flag: "metaInbox",
      },
      {
        id: "content",
        icon: Clapperboard,
        label: "Contenido",
        href: "/admin/contenido",
        flag: "socialPublishing",
      },
    ],
  },
];

/**
 * Los tres accesos de la barra inferior del móvil (el cuarto es siempre «Más»).
 * Inicio lleva «Para hoy», que enlaza a diagnósticos, membresías y enlaces sin
 * pasar por el menú.
 */
export const CRM_BOTTOM_TABS = ["home", "contacts", "payments"] as const satisfies readonly CrmMenuItemId[];

export const findMenuItem = (id: CrmMenuItemId): CrmMenuItem | undefined => {
  if (crmHomeItem.id === id) return crmHomeItem;
  if (crmStatsItem.id === id) return crmStatsItem;
  for (const section of crmMenuSections) {
    for (const item of section.items) {
      if (item.id === id) return item;
      const child = item.items?.find((c) => c.id === id);
      if (child) return child;
    }
  }
  return undefined;
};

/**
 * `/admin` sólo es activo con la ruta exacta; el resto, con sus descendientes.
 * `exact` es para entradas cuya ruta es prefijo de otra del menú.
 */
export const isCrmPathActive = (pathname: string, href: string, exact?: boolean) => {
  if (href === "/") return false;
  if (href === "/admin" || exact) return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
};
