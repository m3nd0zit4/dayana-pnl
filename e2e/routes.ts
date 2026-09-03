/**
 * Manifiesto de rutas del CRM — fuente única para smoke y contrato.
 *
 * `tier` decide si una ruta se puede probar sin base de datos:
 *
 *  - `"preview"`: la página tiene rama `isCrmUiPreview()` con datos mock, así
 *    que renderiza con `CRM_UI_PREVIEW=true` y `DATABASE_URL` vacío. Corre
 *    siempre, también en CI.
 *  - `"auth"`: la página llama a `getStaffSession()` o a la DB sin guardar
 *    previo, así que en preview redirige a `/acceso` o revienta. Solo corre si
 *    hay `DATABASE_URL`.
 *
 * Las banderas `hasPrimaryAction` / `hasPublicLink` / `expectEmpty` describen
 * lo que la ruta DEBE cumplir cuando esté migrada al contrato, no lo que
 * cumple hoy. Mientras la ruta siga en `PENDING_CONTRACT`
 * (`e2e/crm-contract.spec.ts`) no se comprueban.
 */

export type CrmRoute = {
  /** Ruta navegable. Los dinámicos usan un id cualquiera: en preview no se lee. */
  path: string;
  /** Nombre legible para el título del test. */
  name: string;
  tier: "preview" | "auth";
  /** Debe existir una acción primaria de creación dentro del page header. */
  hasPrimaryAction?: boolean;
  /** Debe existir un enlace a la página pública correspondiente. */
  hasPublicLink?: boolean;
  /** En preview los datos mock están vacíos ⇒ debe pintarse un empty state. */
  expectEmpty?: boolean;
  /** Ancho de página: `full` renuncia al max-width del contrato (R1). */
  width?: "default" | "narrow" | "full";
};

export const CRM_ROUTES: CrmRoute[] = [
  // ---------------------------------------------------------------- Tier A
  { path: "/admin", name: "Dashboard", tier: "preview" },
  {
    path: "/admin/contacts",
    name: "Contactos",
    tier: "preview",
    hasPrimaryAction: true,
  },
  {
    path: "/admin/curso",
    name: "Curso · Miembros",
    tier: "preview",
    hasPrimaryAction: true,
  },
  {
    path: "/admin/curso/modulos",
    name: "Curso · Módulos",
    tier: "preview",
    hasPrimaryAction: true,
  },
  {
    // El id no se lee en preview (`curso/modulos/[id]/page.tsx:15-23` lo
    // devuelve tal cual dentro de un módulo mock), así que sirve cualquiera.
    path: "/admin/curso/modulos/preview-module",
    name: "Curso · Detalle de módulo",
    tier: "preview",
    width: "narrow",
  },
  {
    path: "/admin/curso/comentarios",
    name: "Curso · Comentarios",
    tier: "preview",
    expectEmpty: true,
  },
  { path: "/admin/therapies", name: "Terapias", tier: "preview" },
  { path: "/admin/payments", name: "Pagos", tier: "preview" },
  // Las dos pantallas más nuevas del panel, y las últimas en entrar aquí: se
  // construyeron después de este manifiesto, así que nadie comprobaba que
  // cumplieran el contrato de cabecera.
  { path: "/admin/diagnosticos", name: "Diagnósticos", tier: "preview" },
  { path: "/admin/enlaces-pago", name: "Enlaces de pago", tier: "preview" },
  {
    path: "/admin/workshops",
    name: "Talleres",
    tier: "preview",
    hasPrimaryAction: true,
    hasPublicLink: true,
  },
  {
    path: "/admin/webinar",
    name: "Webinar gratuito",
    tier: "preview",
    hasPublicLink: true,
    width: "narrow",
  },
  {
    path: "/admin/products",
    name: "Paquetes",
    tier: "preview",
    hasPrimaryAction: true,
  },
  {
    path: "/admin/promo-codes",
    name: "Códigos promocionales",
    tier: "preview",
    hasPrimaryAction: true,
  },
  { path: "/admin/notificaciones", name: "Notificaciones", tier: "preview" },
  {
    path: "/admin/messages",
    name: "Mensajes rápidos",
    tier: "preview",
    hasPrimaryAction: true,
  },
  {
    path: "/admin/team",
    name: "Equipo",
    tier: "preview",
    hasPrimaryAction: true,
  },
  { path: "/admin/audit", name: "Auditoría", tier: "preview" },

  // ---------------------------------------------------------------- Tier B
  // `contacts/[id]` redirige a la lista en preview; el resto llama a la DB o a
  // `getStaffSession()` sin guardar previo.
  { path: "/admin/contacts/preview-contact", name: "Detalle de contacto", tier: "auth" },
  {
    path: "/admin/enrollments/preview-enrollment",
    name: "Detalle de inscripción",
    tier: "auth",
  },
  { path: "/admin/inbox", name: "Bandeja de entrada", tier: "auth", width: "full" },
  { path: "/admin/contenido", name: "Contenido", tier: "auth", width: "full", hasPublicLink: true },
  { path: "/admin/ajustes/perfil", name: "Ajustes · Perfil", tier: "auth", width: "narrow" },
  { path: "/admin/ajustes/seguridad", name: "Ajustes · Seguridad", tier: "auth", width: "narrow" },
  {
    path: "/admin/ajustes/mis-notificaciones",
    name: "Ajustes · Mis notificaciones",
    tier: "auth",
    width: "narrow",
  },
  {
    path: "/admin/ajustes/general",
    name: "Ajustes · General",
    tier: "auth",
    width: "narrow",
    hasPublicLink: true,
  },
  {
    path: "/admin/ajustes/notificaciones",
    name: "Ajustes · Notificaciones",
    tier: "auth",
    width: "narrow",
  },
  {
    path: "/admin/ajustes/integraciones",
    name: "Ajustes · Integraciones",
    tier: "auth",
    width: "narrow",
  },
  { path: "/admin/ajustes/canales", name: "Ajustes · Canales", tier: "auth", width: "narrow" },
  { path: "/admin/ajustes/registro", name: "Ajustes · Registro", tier: "auth", width: "narrow" },
];

export const previewRoutes = CRM_ROUTES.filter((r) => r.tier === "preview");
export const authRoutes = CRM_ROUTES.filter((r) => r.tier === "auth");
