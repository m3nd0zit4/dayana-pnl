import type { SettingsNavGroup } from "@/app/components/shared/settings/SettingsNav";

/**
 * Índice único de configuración: todo cuelga de `/admin/ajustes`.
 *
 * Antes había dos árboles sin enlazar (`/admin/mi-cuenta` personal y
 * `/admin/ajustes` del sitio) a los que se llegaba por tres botones distintos.
 * Ahora es un solo destino con grupos, y el layout decide qué grupos ve cada
 * rol.
 */

/** Ajustes personales: los ve cualquier miembro del staff. */
export const personalSettingsGroup: SettingsNavGroup = {
  label: "Mi cuenta",
  items: [
    { href: "/admin/ajustes/perfil", label: "Perfil" },
    { href: "/admin/ajustes/seguridad", label: "Seguridad" },
    { href: "/admin/ajustes/mis-notificaciones", label: "Mis notificaciones" },
  ],
};

/**
 * Ajustes globales: solo OWNER.
 *
 * Cada página de estas vuelve a comprobar el rol por su cuenta
 * (`requireOwnerSettings`); esto es la puerta de la UI, no la única defensa.
 */
export const siteSettingsGroups: SettingsNavGroup[] = [
  {
    label: "Sitio",
    items: [
      { href: "/admin/ajustes/general", label: "General" },
      { href: "/admin/ajustes/notificaciones", label: "Notificaciones" },
    ],
  },
  {
    label: "Canales",
    items: [
      { href: "/admin/ajustes/integraciones", label: "Integraciones" },
      { href: "/admin/ajustes/google", label: "Google" },
    ],
  },
  {
    label: "Registro",
    items: [{ href: "/admin/ajustes/registro", label: "Registro de envíos" }],
  },
];

/**
 * Páginas de uso diario que rozan la configuración pero se quedan donde están:
 * viven en el menú principal porque se usan a diario, no una vez al mes. Aquí
 * solo se enlazan para que desde Ajustes se vea que existen.
 */
export const relatedSettingsLinks = [
  {
    href: "/admin/messages",
    label: "Mensajes rápidos",
    description: "Plantillas de WhatsApp y correo",
  },
  {
    href: "/admin/team",
    label: "Staff",
    description: "Altas, roles y accesos del equipo",
  },
  {
    href: "/admin/audit",
    label: "Auditoría",
    description: "Historial de cambios del CRM",
  },
];
