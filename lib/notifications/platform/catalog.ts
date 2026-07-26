import type {
  NotificationEventType,
  NotificationSeverity,
  StaffRole,
} from "@prisma/client";

/**
 * Fuente única de verdad del catálogo de eventos.
 *
 * Este módulo es puro (sin Prisma, sin React) para poder importarlo desde
 * componentes cliente. Alimenta tres cosas a la vez: cómo se renderiza cada
 * notificación, qué filas muestra la matriz de preferencias, y qué miembros del
 * staff son destinatarios por defecto.
 *
 * Al agregar un evento: añádelo al enum `NotificationEventType` de
 * prisma/schema.prisma, crea la migración, y agrega su entrada aquí. El
 * `Record` es exhaustivo, así que TypeScript falla si se te olvida.
 */

export const NOTIFICATION_GROUPS = [
  "Pagos y ventas",
  "Embudo e inscripciones",
  "Terapias",
  "Curso y membresía",
  "Sistema y seguridad",
] as const;

export type NotificationGroup = (typeof NOTIFICATION_GROUPS)[number];

/**
 * Ámbito del evento. OJO: esto NO resuelve destinatarios — para
 * `PAYMENT_APPROVED` el miembro destinatario es el contacto de la inscripción,
 * y el catálogo no puede saber cuál es. Sirve para filtrar la UI de
 * preferencias y para validar las llamadas a emit.
 */
export type NotificationAudienceScope = "STAFF" | "MEMBER" | "BOTH";

export type NotificationCatalogEntry = {
  label: string;
  description: string;
  group: NotificationGroup;
  defaultSeverity: NotificationSeverity;
  audience: NotificationAudienceScope;
  defaultInApp: boolean;
  defaultEmail: boolean;
  /**
   * Roles de staff que lo reciben por defecto.
   *
   * Deliberadamente una lista y no un "minRole": StaffRole no es un orden
   * total en este código — DEVELOPER es hermano de OPERATOR, no inferior
   * (ver lib/crm/staff-permissions.ts).
   */
  roles: readonly StaffRole[];
  /**
   * Ventana de coalescencia en segundos. Si hay una notificación sin leer del
   * mismo evento y entidad dentro de la ventana, se incrementa `metadata.count`
   * en vez de insertar una fila nueva. Omitir = sin coalescencia.
   */
  coalesceWindowSec?: number;
};

const OWNER_ONLY = ["OWNER"] as const satisfies readonly StaffRole[];
const OWNER_OPERATOR = ["OWNER", "OPERATOR"] as const satisfies readonly StaffRole[];
const OWNER_DEV = ["OWNER", "DEVELOPER"] as const satisfies readonly StaffRole[];
const WRITE_ROLES = [
  "OWNER",
  "OPERATOR",
  "DEVELOPER",
] as const satisfies readonly StaffRole[];
/** Solo el miembro; ningún staff lo recibe. */
const NO_STAFF = [] as const satisfies readonly StaffRole[];

export const NOTIFICATION_CATALOG: Record<
  NotificationEventType,
  NotificationCatalogEntry
> = {
  // ── Pagos y ventas ──────────────────────────────────────────────────────
  PAYMENT_APPROVED: {
    label: "Pago aprobado",
    description: "Se confirmó un pago de PayPal, Mercado Pago o manual.",
    group: "Pagos y ventas",
    defaultSeverity: "SUCCESS",
    audience: "BOTH",
    defaultInApp: true,
    defaultEmail: true,
    roles: WRITE_ROLES,
  },
  PAYMENT_FAILED: {
    label: "Pago rechazado",
    description: "Un intento de pago falló o fue rechazado por la pasarela.",
    group: "Pagos y ventas",
    defaultSeverity: "WARNING",
    audience: "STAFF",
    defaultInApp: true,
    defaultEmail: false,
    roles: OWNER_OPERATOR,
  },
  PAYMENT_REFUNDED: {
    label: "Pago reembolsado",
    description: "Se devolvió el dinero de un pago aprobado.",
    group: "Pagos y ventas",
    defaultSeverity: "WARNING",
    audience: "BOTH",
    defaultInApp: true,
    defaultEmail: true,
    roles: OWNER_OPERATOR,
  },
  MANUAL_PAYMENT_RECORDED: {
    label: "Pago manual registrado",
    description:
      "Alguien del equipo registró un pago en efectivo o transferencia.",
    group: "Pagos y ventas",
    defaultSeverity: "SUCCESS",
    audience: "STAFF",
    defaultInApp: true,
    defaultEmail: false,
    roles: OWNER_OPERATOR,
  },
  PAYMENT_WEBHOOK_FAILED: {
    label: "Error en webhook de pago",
    description:
      "El webhook de PayPal o Mercado Pago devolvió error. Puede haber pagos sin registrar.",
    group: "Pagos y ventas",
    defaultSeverity: "ERROR",
    audience: "STAFF",
    defaultInApp: true,
    defaultEmail: true,
    roles: OWNER_DEV,
    coalesceWindowSec: 900,
  },

  // ── Embudo e inscripciones ──────────────────────────────────────────────
  LEAD_CREATED: {
    label: "Nuevo lead",
    description: "Se creó una inscripción en estado LEAD.",
    group: "Embudo e inscripciones",
    defaultSeverity: "INFO",
    audience: "STAFF",
    defaultInApp: true,
    defaultEmail: false,
    roles: WRITE_ROLES,
  },
  WEB_LEAD_SUBMITTED: {
    label: "Formulario web recibido",
    description: "Alguien llenó el formulario de contacto del sitio público.",
    group: "Embudo e inscripciones",
    defaultSeverity: "INFO",
    audience: "STAFF",
    defaultInApp: true,
    defaultEmail: true,
    roles: OWNER_OPERATOR,
  },
  ENROLLMENT_PENDING_PAYMENT: {
    label: "Checkout iniciado",
    description: "Un cliente llegó al checkout pero aún no ha pagado.",
    group: "Embudo e inscripciones",
    defaultSeverity: "INFO",
    audience: "STAFF",
    defaultInApp: true,
    defaultEmail: false,
    roles: OWNER_OPERATOR,
  },
  ENROLLMENT_ACTIVATED: {
    label: "Inscripción activada",
    description: "Una inscripción pasó a ACTIVE tras confirmarse el pago.",
    group: "Embudo e inscripciones",
    defaultSeverity: "SUCCESS",
    audience: "BOTH",
    defaultInApp: true,
    defaultEmail: false,
    roles: WRITE_ROLES,
  },
  ENROLLMENT_STATUS_CHANGED: {
    label: "Estado de inscripción actualizado",
    description: "Cambió el estado de una inscripción existente.",
    group: "Embudo e inscripciones",
    defaultSeverity: "INFO",
    audience: "STAFF",
    defaultInApp: true,
    defaultEmail: false,
    roles: WRITE_ROLES,
  },
  CHECKOUT_ABANDONED: {
    label: "Checkout abandonado",
    description: "Un checkout quedó sin completar y se marcó como abandonado.",
    group: "Embudo e inscripciones",
    defaultSeverity: "WARNING",
    audience: "STAFF",
    defaultInApp: true,
    defaultEmail: false,
    roles: OWNER_OPERATOR,
    coalesceWindowSec: 3600,
  },
  LEAD_STALE: {
    label: "Lead sin seguimiento",
    description: "Un lead lleva demasiado tiempo sin actividad.",
    group: "Embudo e inscripciones",
    defaultSeverity: "WARNING",
    audience: "STAFF",
    defaultInApp: true,
    defaultEmail: false,
    roles: OWNER_OPERATOR,
  },

  // ── Terapias ────────────────────────────────────────────────────────────
  THERAPY_SESSION_SCHEDULED: {
    label: "Sesión agendada",
    description: "Se asignó fecha y hora a una sesión de terapia.",
    group: "Terapias",
    defaultSeverity: "SUCCESS",
    audience: "BOTH",
    defaultInApp: true,
    defaultEmail: false,
    roles: OWNER_OPERATOR,
  },
  THERAPY_SESSION_RESCHEDULED: {
    label: "Sesión reprogramada",
    description: "Cambió la fecha, hora o enlace de una sesión ya agendada.",
    group: "Terapias",
    defaultSeverity: "INFO",
    audience: "BOTH",
    defaultInApp: true,
    defaultEmail: false,
    roles: OWNER_OPERATOR,
  },
  THERAPY_SESSION_COMPLETED: {
    label: "Sesión completada",
    description: "Se marcó una sesión como realizada.",
    group: "Terapias",
    defaultSeverity: "SUCCESS",
    audience: "STAFF",
    defaultInApp: true,
    defaultEmail: false,
    roles: OWNER_OPERATOR,
  },
  THERAPY_SESSION_NO_SHOW: {
    label: "Inasistencia a sesión",
    description: "El cliente no se presentó a una sesión agendada.",
    group: "Terapias",
    defaultSeverity: "WARNING",
    audience: "STAFF",
    defaultInApp: true,
    defaultEmail: false,
    roles: OWNER_OPERATOR,
  },

  // ── Curso y membresía ───────────────────────────────────────────────────
  MEMBER_SIGNED_UP: {
    label: "Nueva cuenta de miembro",
    description: "Un contacto creó su cuenta en el portal del curso.",
    group: "Curso y membresía",
    defaultSeverity: "SUCCESS",
    audience: "STAFF",
    defaultInApp: true,
    defaultEmail: false,
    roles: OWNER_OPERATOR,
  },
  MEMBERSHIP_DUE_SOON: {
    label: "Mensualidad por vencer",
    description: "La membresía de un miembro vence en los próximos días.",
    group: "Curso y membresía",
    defaultSeverity: "WARNING",
    audience: "BOTH",
    defaultInApp: true,
    defaultEmail: false,
    roles: OWNER_ONLY,
  },
  MEMBERSHIP_OVERDUE: {
    label: "Mensualidad vencida",
    description: "La membresía venció y el acceso al curso está en riesgo.",
    group: "Curso y membresía",
    defaultSeverity: "ERROR",
    audience: "BOTH",
    defaultInApp: true,
    defaultEmail: true,
    roles: OWNER_OPERATOR,
  },
  MEMBERSHIP_EXTENDED: {
    label: "Membresía extendida",
    description: "Un pago extendió la fecha de vencimiento de la membresía.",
    group: "Curso y membresía",
    defaultSeverity: "SUCCESS",
    audience: "MEMBER",
    defaultInApp: true,
    defaultEmail: false,
    roles: NO_STAFF,
  },
  LESSON_COMMENT_POSTED: {
    label: "Nuevo comentario en clase",
    description: "Un miembro dejó un comentario en una clase del curso.",
    group: "Curso y membresía",
    defaultSeverity: "INFO",
    audience: "STAFF",
    defaultInApp: true,
    defaultEmail: true,
    roles: OWNER_OPERATOR,
  },
  CLASS_RECORDING_PUBLISHED: {
    label: "Grabación publicada",
    description: "Se publicó la grabación de una clase en vivo.",
    group: "Curso y membresía",
    defaultSeverity: "INFO",
    audience: "MEMBER",
    defaultInApp: true,
    defaultEmail: false,
    roles: NO_STAFF,
  },

  // ── Sistema y seguridad ─────────────────────────────────────────────────
  LOGIN_FAILED: {
    label: "Intento de acceso fallido",
    description: "Alguien falló al iniciar sesión en el CRM.",
    group: "Sistema y seguridad",
    defaultSeverity: "WARNING",
    audience: "STAFF",
    defaultInApp: true,
    defaultEmail: false,
    roles: OWNER_ONLY,
    coalesceWindowSec: 900,
  },
  LOGIN_SUCCEEDED: {
    label: "Inicio de sesión",
    description:
      "Alguien del equipo inició sesión. Desactivado por defecto: es ruidoso.",
    group: "Sistema y seguridad",
    defaultSeverity: "INFO",
    audience: "STAFF",
    defaultInApp: false,
    defaultEmail: false,
    roles: OWNER_ONLY,
  },
  STAFF_USER_CREATED: {
    label: "Usuario de staff creado",
    description: "Se agregó una cuenta nueva al equipo.",
    group: "Sistema y seguridad",
    defaultSeverity: "INFO",
    audience: "STAFF",
    defaultInApp: true,
    defaultEmail: true,
    roles: OWNER_ONLY,
  },
  AGENT_ACTION_EXECUTED: {
    label: "Acción del asistente IA",
    description: "El asistente ejecutó una acción que modificó datos.",
    group: "Sistema y seguridad",
    defaultSeverity: "INFO",
    audience: "STAFF",
    defaultInApp: true,
    defaultEmail: false,
    roles: OWNER_DEV,
    coalesceWindowSec: 300,
  },
  CAMPAIGN_COMPLETED: {
    label: "Campaña finalizada",
    description: "Terminó el envío masivo de una campaña de notificaciones.",
    group: "Sistema y seguridad",
    defaultSeverity: "SUCCESS",
    audience: "STAFF",
    defaultInApp: true,
    defaultEmail: true,
    roles: OWNER_ONLY,
  },
  NOTIFICATION_DELIVERY_FAILED: {
    label: "Fallo de envío",
    description:
      "No se pudo entregar un correo, SMS o WhatsApp a un destinatario.",
    group: "Sistema y seguridad",
    defaultSeverity: "ERROR",
    audience: "STAFF",
    defaultInApp: true,
    defaultEmail: false,
    roles: OWNER_DEV,
    coalesceWindowSec: 3600,
  },
  SYSTEM_ALERT: {
    label: "Alerta del sistema",
    description: "Aviso general de la plataforma que requiere atención.",
    group: "Sistema y seguridad",
    defaultSeverity: "ERROR",
    audience: "STAFF",
    defaultInApp: true,
    defaultEmail: true,
    roles: OWNER_DEV,
  },
};

const ALL_EVENT_TYPES = Object.keys(
  NOTIFICATION_CATALOG
) as NotificationEventType[];

/** Eventos que un rol de staff puede recibir, en orden de catálogo. */
export const staffEventTypesFor = (
  role: StaffRole
): NotificationEventType[] =>
  ALL_EVENT_TYPES.filter((type) => {
    const entry = NOTIFICATION_CATALOG[type];
    return entry.audience !== "MEMBER" && entry.roles.includes(role);
  });

/** Eventos que puede recibir un miembro del portal. */
export const memberEventTypes = (): NotificationEventType[] =>
  ALL_EVENT_TYPES.filter(
    (type) => NOTIFICATION_CATALOG[type].audience !== "STAFF"
  );

/** Agrupa una lista de eventos por su `group`, respetando el orden del catálogo. */
export const groupEventTypes = (
  types: readonly NotificationEventType[]
): { group: NotificationGroup; types: NotificationEventType[] }[] =>
  NOTIFICATION_GROUPS.map((group) => ({
    group,
    types: types.filter((type) => NOTIFICATION_CATALOG[type].group === group),
  })).filter((section) => section.types.length > 0);

export const catalogEntry = (type: NotificationEventType) =>
  NOTIFICATION_CATALOG[type];
