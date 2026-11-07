/**
 * The one list of what the CRM's agents can do. Pure data — no tool imports —
 * so the panel UI can read labels from it and the MCP server can read access
 * levels from it without pulling in every tool's server code.
 *
 * Three consumers, one source:
 * - `agent/tools/crm.ts` and `agent/subagents/<id>/tools/crm.ts` hand each
 *   agent only the tools listed for it here.
 * - `lib/mcp/server.ts` exposes every tool, gated by `access` against the
 *   token's scopes.
 * - The panel shows `label` instead of the raw tool name.
 *
 * `access` is what a token or a role needs to call the tool:
 * - `read`: looks, never changes anything.
 * - `edit`: changes CRM data that only the team sees (a contact, a draft, a
 *   workshop, the agent's own memory).
 * - `execute`: reaches outside the CRM or moves money — a WhatsApp/email/SMS
 *   that a real person receives, a payment, a site-wide price, a staff account.
 */

export type ToolAccess = "read" | "edit" | "execute";

export const SPECIALIST_IDS = ["ventas", "whatsapp", "agenda", "talleres", "contactos"] as const;
export type SpecialistId = (typeof SPECIALIST_IDS)[number];
/** `auto` is the router: answers quick questions itself, delegates the rest. */
export type AgentId = "auto" | SpecialistId;

export const isAgentId = (value: unknown): value is AgentId =>
  value === "auto" || (SPECIALIST_IDS as readonly unknown[]).includes(value);

export type AgentProfile = {
  id: AgentId;
  label: string;
  /** One line under the name in the picker. */
  tagline: string;
  /** What the router reads to decide whether to delegate. */
  description: string;
  /** Starter prompts for the empty state. */
  suggestions: string[];
};

export const AGENT_PROFILES: Record<AgentId, AgentProfile> = {
  auto: {
    id: "auto",
    label: "Asistente",
    tagline: "Responde y reparte el trabajo entre los especialistas",
    description: "Router: answers quick lookups and statistics itself and delegates domain work.",
    suggestions: [
      "¿Cuánto vendimos este mes comparado con el anterior?",
      "¿Qué tengo pendiente hoy?",
      "Busca a la clienta María y dime qué ha comprado",
    ],
  },
  ventas: {
    id: "ventas",
    label: "Ventas",
    tagline: "Estadísticas, pagos, inscripciones, precios y códigos",
    description:
      "Sales & statistics specialist: revenue, conversion and funnel stats, payments (lists, totals, manual payments with OTP), enrollments, products, prices, promo codes, the USD→COP rate.",
    suggestions: [
      "Ventas de los últimos 30 días por producto",
      "¿Qué pagos fallaron esta semana y por qué?",
      "¿Cuántas personas están pendientes de pago?",
    ],
  },
  whatsapp: {
    id: "whatsapp",
    label: "WhatsApp",
    tagline: "Chats, la IA de WhatsApp y cómo responde",
    description:
      "WhatsApp specialist: finds chats, reads conversations, explains and corrects what the WhatsApp AI answered, turns corrections into playbooks, changes its configuration, drafts and sends WhatsApp messages.",
    suggestions: [
      "¿Qué chats me tocan ahora?",
      "No me gustó lo que la IA le respondió a Laura, revísalo",
      "¿Cómo le fue a la IA en las últimas 24 horas?",
    ],
  },
  agenda: {
    id: "agenda",
    label: "Agenda",
    tagline: "Calendario, citas, reservas y días de descanso",
    description:
      "Calendar specialist: Google Calendar events, appointments and WhatsApp bookings, blocking time off so nothing gets booked, booking hours of the WhatsApp AI, time-zone conversions.",
    suggestions: [
      "¿Qué tengo agendado esta semana?",
      "Bloquéame el viernes, no quiero citas ese día",
      "¿A qué hora es el taller en España?",
    ],
  },
  talleres: {
    id: "talleres",
    label: "Talleres y eventos",
    tagline: "Talleres, eventos gratuitos, inscritas e interesadas",
    description:
      "Workshops & free events specialist: workshop editions, their product and prices, enrollees and interested people, free webinars/events and their registrations, documents, bulk WhatsApp to an event audience.",
    suggestions: [
      "¿Cuántas inscritas tiene el próximo taller?",
      "Crea un taller nuevo para diciembre",
      "¿Quiénes se registraron al evento gratuito?",
    ],
  },
  contactos: {
    id: "contactos",
    label: "Contactos y equipo",
    tagline: "Personas, correos, SMS, Google y el equipo",
    description:
      "Contacts specialist: search, create and dedupe contacts, Google contacts import, one-off and bulk email, SMS, Drive uploads, staff accounts.",
    suggestions: [
      "Crea el contacto de Ana, +57 300 123 4567",
      "Mándale un correo a Paula con el enlace del taller",
      "¿Quién cambió el precio de la terapia?",
    ],
  },
};

export const AGENT_ORDER: AgentId[] = ["auto", ...SPECIALIST_IDS];

type CatalogEntry = {
  access: ToolAccess;
  /** Agents whose tool set includes this tool. `auto` = the router. */
  agents: AgentId[];
  /** Spanish, sentence case, shown in the panel while it runs. */
  label: string;
};

const ALL: AgentId[] = ["auto", ...SPECIALIST_IDS];

export const TOOL_CATALOG = {
  // ── shared reads ────────────────────────────────────────────────────────
  search_contacts: { access: "read", agents: ALL, label: "Buscar contactos" },
  get_contact: { access: "read", agents: ALL, label: "Ver contacto" },
  memory: { access: "edit", agents: ALL, label: "Memoria" },
  crm_stats: { access: "read", agents: ["auto", "ventas", "whatsapp", "talleres"], label: "Estadísticas" },
  dashboard_stats: { access: "read", agents: ["auto", "ventas"], label: "Resumen del panel" },
  pending_tasks: { access: "read", agents: ["auto", "ventas", "whatsapp"], label: "Pendientes" },
  list_products: { access: "read", agents: ["auto", "ventas", "talleres"], label: "Productos" },
  get_enrollment: { access: "read", agents: ["auto", "ventas", "talleres"], label: "Ver inscripción" },
  list_payments: { access: "read", agents: ["auto", "ventas"], label: "Pagos" },
  get_payment: { access: "read", agents: ["auto", "ventas"], label: "Ver pago" },
  list_notifications: { access: "read", agents: ALL, label: "Mis notificaciones" },
  query_audit_log: { access: "read", agents: ["auto", "ventas", "contactos"], label: "Historial de cambios" },
  convert_event_timezone: { access: "read", agents: ["agenda", "talleres"], label: "Convertir horario" },

  // ── ventas ──────────────────────────────────────────────────────────────
  list_enrollments: { access: "read", agents: ["ventas", "talleres"], label: "Inscripciones" },
  create_therapy_enrollment: { access: "edit", agents: ["ventas"], label: "Crear inscripción de terapia" },
  request_payment_otp: { access: "execute", agents: ["ventas"], label: "Pedir código de pago" },
  record_manual_payment: { access: "execute", agents: ["ventas"], label: "Registrar pago manual" },
  create_promo_code: { access: "edit", agents: ["ventas"], label: "Crear código promocional" },
  update_promo_code: { access: "edit", agents: ["ventas"], label: "Editar código promocional" },
  update_product_price: { access: "execute", agents: ["ventas"], label: "Cambiar precio" },
  update_usd_to_cop_rate: { access: "execute", agents: ["ventas"], label: "Cambiar tasa USD→COP" },
  list_payment_receipts: { access: "read", agents: ["ventas", "whatsapp", "auto"], label: "Comprobantes por WhatsApp" },

  // ── whatsapp ────────────────────────────────────────────────────────────
  whatsapp_find_chat: { access: "read", agents: ["whatsapp"], label: "Buscar chats" },
  whatsapp_ai_status: { access: "read", agents: ["whatsapp", "auto"], label: "Estado de la IA de WhatsApp" },
  whatsapp_get_config: { access: "read", agents: ["whatsapp", "agenda"], label: "Configuración de la IA" },
  whatsapp_update_config: { access: "edit", agents: ["whatsapp", "agenda"], label: "Cambiar configuración de la IA" },
  whatsapp_list_playbooks: { access: "read", agents: ["whatsapp"], label: "Guiones de la IA" },
  whatsapp_save_playbook: { access: "edit", agents: ["whatsapp"], label: "Guardar guion de la IA" },
  whatsapp_set_chat: { access: "edit", agents: ["whatsapp"], label: "Cambiar quién atiende el chat" },
  whatsapp_simulate_reply: { access: "read", agents: ["whatsapp"], label: "Simular respuesta de la IA" },
  list_conversations: { access: "read", agents: ["whatsapp"], label: "Bandeja de entrada" },
  get_conversation: { access: "read", agents: ["whatsapp"], label: "Leer conversación" },
  list_whatsapp_messages: { access: "read", agents: ["whatsapp"], label: "Mensajes del chat" },
  list_ai_runs: { access: "read", agents: ["whatsapp", "auto"], label: "Ejecuciones de la IA" },
  draft_conversation_reply: { access: "edit", agents: ["whatsapp"], label: "Dejar borrador" },
  link_conversation_to_contact: { access: "edit", agents: ["whatsapp", "contactos"], label: "Vincular chat a contacto" },
  list_message_templates: { access: "read", agents: ["whatsapp", "contactos"], label: "Plantillas" },
  prepare_customer_whatsapp_message: { access: "edit", agents: ["whatsapp"], label: "Preparar enlace de WhatsApp" },
  send_whatsapp_to_contact: { access: "execute", agents: ["whatsapp"], label: "Enviar WhatsApp" },
  send_whatsapp_bulk: { access: "execute", agents: ["whatsapp", "talleres"], label: "Envío masivo de WhatsApp" },

  // ── agenda ──────────────────────────────────────────────────────────────
  list_google_accounts: { access: "read", agents: ["agenda", "contactos"], label: "Cuentas de Google" },
  list_calendar_events: { access: "read", agents: ["agenda"], label: "Ver calendario" },
  list_appointments: { access: "read", agents: ["agenda", "whatsapp", "auto"], label: "Citas y reservas" },
  create_calendar_event: { access: "edit", agents: ["agenda"], label: "Crear evento" },
  update_calendar_event: { access: "edit", agents: ["agenda"], label: "Mover evento" },

  // ── talleres ────────────────────────────────────────────────────────────
  list_workshop_editions: { access: "read", agents: ["talleres", "auto"], label: "Talleres" },
  get_workshop_edition: { access: "read", agents: ["talleres"], label: "Ver taller" },
  list_workshop_enrollees: { access: "read", agents: ["talleres", "auto"], label: "Inscritas e interesadas del taller" },
  create_workshop: { access: "edit", agents: ["talleres"], label: "Crear taller" },
  update_workshop: { access: "edit", agents: ["talleres"], label: "Editar taller" },
  create_workshop_product: { access: "edit", agents: ["talleres"], label: "Crear producto del taller" },
  list_workshop_documents: { access: "read", agents: ["talleres"], label: "Documentos del taller" },
  get_free_webinar: { access: "read", agents: ["talleres"], label: "Ver evento gratuito" },
  list_free_event_registrations: { access: "read", agents: ["talleres", "auto"], label: "Inscritas al evento gratuito" },
  update_free_webinar: { access: "edit", agents: ["talleres"], label: "Editar evento gratuito" },
  deactivate_free_webinar: { access: "edit", agents: ["talleres"], label: "Cerrar evento gratuito" },

  // ── contactos ───────────────────────────────────────────────────────────
  create_contact: { access: "edit", agents: ["contactos", "ventas"], label: "Crear contacto" },
  search_google_contacts: { access: "read", agents: ["contactos"], label: "Buscar en Google" },
  import_google_contact: { access: "edit", agents: ["contactos"], label: "Importar de Google" },
  send_contact_email: { access: "execute", agents: ["contactos"], label: "Enviar correo" },
  send_contact_template_email: { access: "execute", agents: ["contactos"], label: "Enviar plantilla por correo" },
  send_contact_sms: { access: "execute", agents: ["contactos"], label: "Enviar SMS" },
  send_bulk_email: { access: "execute", agents: ["contactos"], label: "Campaña de correo" },
  upload_drive_file: { access: "execute", agents: ["contactos"], label: "Subir a Drive" },
  create_staff_user: { access: "execute", agents: ["contactos"], label: "Crear usuario del equipo" },
} satisfies Record<string, CatalogEntry>;

export type ToolName = keyof typeof TOOL_CATALOG;

export const toolsForAgent = (agent: AgentId): ToolName[] =>
  (Object.keys(TOOL_CATALOG) as ToolName[]).filter((name) =>
    (TOOL_CATALOG[name].agents as AgentId[]).includes(agent)
  );

export const toolLabel = (name: string): string | undefined =>
  (TOOL_CATALOG as Record<string, CatalogEntry>)[name]?.label ??
  (isAgentId(name) ? `Especialista: ${AGENT_PROFILES[name].label}` : undefined);
