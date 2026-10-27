import type { SettingsNavGroup } from "@/app/components/shared/settings/SettingsNav";
import type { SettingsHubGroup } from "@/lib/crm/settings-hub";

/**
 * Todo lo que se configura, agrupado por PARA QUÉ sirve y no por dónde vive en
 * el código. Es la única fuente del centro de ajustes: de aquí salen las
 * tarjetas de `/admin/ajustes`, el menú lateral de sus páginas y el buscador.
 *
 * Una entrada no mueve nada: lleva a la página donde ya vive el ajuste. Lo que
 * se usa a diario (mensajes rápidos, precios, enlaces de pago) se queda junto a
 * su función: no tiene tarjeta aquí (`searchOnly`), solo se encuentra con el
 * buscador.
 *
 * Los grupos con `ownerOnly` no se pintan a quien no administra el equipo. Es
 * cosmético: cada página y cada endpoint vuelve a exigir el rol por su cuenta.
 */
export const settingsHubGroups: SettingsHubGroup[] = [
  {
    id: "cuenta",
    title: "Mi cuenta",
    purpose: "Tu perfil y cómo te avisamos a ti.",
    items: [
      {
        id: "perfil",
        label: "Perfil y tema",
        hint: "Tu nombre, tu foto y el modo claro u oscuro",
        href: "/admin/ajustes/perfil",
        keywords: ["nombre", "foto", "avatar", "tema", "oscuro", "claro", "apariencia", "modo oscuro"],
      },
      {
        id: "seguridad",
        label: "Seguridad y sesiones",
        hint: "Tu contraseña y los dispositivos donde tienes la sesión abierta",
        href: "/admin/ajustes/seguridad",
        keywords: ["contraseña", "clave", "sesión", "sesiones", "dispositivos", "cerrar sesión", "acceso"],
      },
      {
        id: "mis-notificaciones",
        label: "Mis notificaciones",
        hint: "Qué avisos te llegan a ti, y si por correo",
        href: "/admin/ajustes/mis-notificaciones",
        keywords: ["avisos", "campana", "correo", "alertas", "notificar"],
      },
    ],
  },
  {
    id: "negocio",
    title: "Negocio",
    purpose: "Datos del sitio y cómo se cobra.",
    ownerOnly: true,
    items: [
      {
        id: "general",
        label: "General",
        hint: "Zona horaria, tasa USD a COP y dirección del sitio",
        href: "/admin/ajustes/general",
        keywords: ["zona horaria", "hora", "dólar", "tasa", "cop", "usd", "moneda", "cambio", "dirección", "url", "sitio"],
      },
      {
        id: "pagos",
        label: "Pagos",
        hint: "Estado de PayPal y Mercado Pago",
        href: "/admin/ajustes/integraciones#pagos",
        keywords: ["paypal", "mercado pago", "cobros", "comisión", "webhook", "tarjeta", "pse", "nequi"],
        hidden: "nav",
      },
    ],
  },
  {
    id: "correo",
    title: "Correo y avisos",
    purpose: "Quién recibe qué, y cuándo.",
    ownerOnly: true,
    items: [
      {
        id: "notificaciones",
        label: "Notificaciones del sitio",
        hint: "Envío real o simulado, buzón de alertas y cuánto tiempo se guardan",
        href: "/admin/ajustes/notificaciones",
        keywords: [
          "correo",
          "email",
          "envío real",
          "simulado",
          "modo simulado",
          "buzón",
          "alertas",
          "retención",
          "avisos apagados",
          "quién recibe",
        ],
      },
      {
        id: "registro",
        label: "Registro de envíos",
        hint: "Qué se mandó, a quién y si salió",
        href: "/admin/ajustes/registro",
        keywords: ["historial", "enviados", "correos enviados", "fallaron", "entregas", "log"],
      },
    ],
  },
  {
    id: "whatsapp",
    title: "WhatsApp e IA",
    purpose: "Cómo contesta y agenda tu asistente.",
    ownerOnly: true,
    items: [
      {
        id: "whatsapp-ajustes",
        label: "Asistente de WhatsApp",
        hint: "Conexión, respuestas, horarios y citas, avisos y plantillas",
        href: "/admin/whatsapp/ajustes",
        keywords: ["whatsapp", "ia", "asistente", "inteligencia artificial", "respuesta automática", "citas", "agenda", "plantillas"],
      },
      {
        id: "canales",
        label: "Canales del agente",
        hint: "Por dónde se puede hablar con el asistente",
        href: "/admin/ajustes/canales",
        keywords: ["agente", "canal", "panel", "asistente del panel", "encender"],
      },
    ],
  },
  {
    id: "conexiones",
    title: "Conexiones",
    purpose: "Tus cuentas externas y el estado de sus llaves.",
    ownerOnly: true,
    items: [
      {
        id: "integraciones",
        label: "Integraciones",
        hint: "Todas las conexiones en una página",
        href: "/admin/ajustes/integraciones",
        keywords: ["integraciones", "conexiones", "conectar", "cuentas"],
        hidden: "hub",
      },
      {
        id: "meta",
        label: "Meta (Instagram y Facebook)",
        hint: "Conectar la página y recibir los mensajes",
        href: "/admin/ajustes/integraciones#redes-sociales",
        keywords: ["meta", "instagram", "facebook", "messenger", "mensajes", "página"],
        hidden: "nav",
      },
      {
        id: "tiktok",
        label: "TikTok",
        hint: "Conectar la cuenta para programar videos",
        href: "/admin/ajustes/integraciones#redes-sociales",
        keywords: ["tiktok", "videos", "publicar", "programar"],
        hidden: "nav",
      },
      {
        id: "google",
        label: "Google (calendario)",
        hint: "La cuenta que se usa para las citas",
        href: "/admin/ajustes/integraciones#google",
        keywords: ["google", "calendario", "calendar", "meet", "gmail", "citas"],
        hidden: "nav",
      },
      {
        id: "llaves",
        label: "Estado de las llaves",
        hint: "Qué claves están puestas y cuáles faltan, y un correo de prueba",
        href: "/admin/ajustes/integraciones#sistema",
        keywords: ["llaves", "claves", "api", "tokens", "variables", "correo de prueba", "falta"],
        hidden: "nav",
      },
    ],
  },
  {
    id: "equipo",
    title: "Equipo",
    purpose: "Quién entra y qué hizo.",
    ownerOnly: true,
    items: [
      {
        id: "staff",
        label: "Staff y roles",
        hint: "Altas, roles y accesos del equipo",
        href: "/admin/team",
        keywords: ["equipo", "usuarios", "personas", "roles", "permisos", "invitar", "accesos"],
      },
      {
        id: "auditoria",
        label: "Auditoría",
        hint: "Historial de cambios del CRM",
        href: "/admin/audit",
        keywords: ["historial", "cambios", "quién hizo", "registro de acciones", "log"],
      },
    ],
  },
  {
    // Lo que se usa a diario vive junto a su función y no tiene tarjeta aquí,
    // pero quien lo busca en Ajustes lo encuentra escribiéndolo.
    id: "en-su-pantalla",
    title: "En su propia pantalla",
    purpose: "Lo que se usa a diario vive junto a su función.",
    searchOnly: true,
    items: [
      {
        id: "mensajes-rapidos",
        label: "Mensajes rápidos",
        hint: "Textos para escribirle a la gente, por WhatsApp o correo",
        href: "/admin/messages",
        keywords: ["plantillas", "textos", "respuestas", "copiar", "pegar", "mensajes"],
      },
      {
        id: "paquetes",
        label: "Paquetes y precios",
        hint: "Qué se vende y cuánto cuesta",
        href: "/admin/products",
        keywords: ["precio", "precios", "paquete", "terapia", "taller", "curso", "tarifa", "valor", "cuánto cuesta"],
      },
      {
        id: "codigos",
        label: "Códigos promocionales",
        hint: "Descuentos",
        href: "/admin/promo-codes",
        keywords: ["descuento", "cupón", "promo", "código"],
      },
      {
        id: "palabras-clave",
        label: "Palabras clave",
        hint: "«Comenta ÉXITO» y el material que se manda",
        href: "/admin/palabras-clave",
        keywords: ["comenta", "material", "video", "respuesta lista"],
      },
      {
        id: "enlaces-pago",
        label: "Enlaces de pago",
        hint: "Cobrar a una persona con un monto libre o un paquete",
        href: "/admin/enlaces-pago",
        keywords: ["cobrar", "link", "monto libre", "pago"],
      },
    ],
  },
];

/**
 * Los grupos del menú lateral de las páginas de ajustes, para el rol dado.
 * Salen de las mismas entradas que las tarjetas; los atajos a una sección de
 * otra página (`hidden: "nav"`) no se repiten aquí.
 */
export const settingsNavGroups = (isOwner: boolean): SettingsNavGroup[] =>
  settingsHubGroups
    .filter((group) => !group.searchOnly && (!group.ownerOnly || isOwner))
    .map((group) => ({
      label: group.title,
      items: group.items
        .filter((item) => item.hidden !== "nav")
        .map((item) => ({ href: item.href, label: item.label })),
    }))
    .filter((group) => group.items.length > 0);
