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
 * - `execute`: reaches outside the CRM or moves money — anything a client or
 *   the public sees (a public page, a Meet link, a calendar invite, how the
 *   WhatsApp AI answers clients), a WhatsApp/email/SMS
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
  /**
   * What the router reads to decide whether to delegate (and eve shows it as
   * the specialist tool's description). Owns · ask it for · NOT its job (→ who).
   * 8-nov: one-line descriptions sent «hoy solo de 5 a 7» to the WhatsApp
   * specialist, which wrote it as text the AI's hours never read.
   */
  description: string;
  /** Starter prompts for the empty state. */
  suggestions: string[];
};

export const AGENT_PROFILES: Record<AgentId, AgentProfile> = {
  auto: {
    id: "auto",
    label: "Asistente",
    tagline: "Responde y reparte el trabajo entre los especialistas",
    description:
      "Router: answers quick lookups and statistics itself and hands every domain task to the specialist that owns it.",
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
      "Sales & money specialist. OWNS: sales and funnel statistics (revenue per currency, conversion, failed payments and why, best products, comparisons between periods), the payments list and totals, recording a manual payment (cash, transfer, Nequi… with the owner's e-mailed code), enrollments (who bought what, pending payment, creating a therapy enrollment), products and prices, promo codes, the USD→COP rate. ASK IT FOR: «¿cuánto vendimos?», «¿quién no ha pagado?», «registra el pago de Ana», «sube el precio del paquete de 6», «crea un código del 10 %». NOT ITS JOB: payment receipts that arrived by WhatsApp and the WhatsApp AI's payment messages (→ whatsapp), workshop seats and workshop products (→ talleres), calendar or booking hours (→ agenda).",
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
      "WhatsApp specialist. OWNS: Dayana's WhatsApp chats and the WhatsApp AI that answers them — finding a chat, reading what was said and who wrote it, the «Te toca» queue, what the AI answered and why, correcting HOW it answers (tone, rules, playbooks, instructions for one person), pausing/resuming the AI or choosing who handles a chat, writing or sending a WhatsApp to one person (also chats with no contact), bulk WhatsApp (with a dry run first), receipts sent by WhatsApp, the Instagram/Messenger inbox drafts. ASK IT FOR: «escríbele a Laura que…», «¿qué le dijo la IA a Rosa?», «la IA no debe ofrecer X», «pausa la IA en el chat de Ana», «¿qué chats me tocan?». NOT ITS JOB: WHEN Dayana can take calls — hours of a day, days off, blocking time, moving or cancelling an appointment in the calendar (→ agenda; never written as AI instructions); money and payments registered in the CRM (→ ventas); contacts, e-mail and SMS (→ contactos).",
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
      "Calendar & availability specialist. OWNS: Dayana's Google Calendar (events, appointments, free calls booked by the WhatsApp AI), WHEN she can take calls — the hours of one specific day («hoy solo de 5 a 7», «mañana solo en la mañana», «el sábado no agendes») with booking_set_day_hours, days off and blocked time, the weekly booking hours and services, creating, moving or cancelling an appointment, what is booked on a day, time-zone conversions («¿qué hora es en Argentina?»). ASK IT FOR: «¿qué tengo hoy?», «hoy solo agenda de 5 a 7», «bloquéame el viernes», «mueve la cita de Patricia al lunes 9:45», «¿a qué hora es el taller en España?». NOT ITS JOB: writing the WhatsApp message to the person (→ whatsapp: when a call is moved, the agenda moves the appointment and the whatsapp specialist writes to her), how the WhatsApp AI talks (→ whatsapp), payments (→ ventas).",
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
      "Workshops & free events specialist. OWNS: workshop editions (creating, editing, opening/closing sign-ups, date and schedule labels), the workshop's product and price, who enrolled and paid, the «Interesadas» list, free webinars/events, their registrations and their Meet link (a workshop edition has no Meet field), workshop documents, bulk WhatsApp to an event or workshop audience. ASK IT FOR: «crea el taller de diciembre», «¿cuántas inscritas tiene el taller?», «¿quiénes se registraron al webinar?», «cambia el enlace de Meet del evento». NOT ITS JOB: one person's chat or a one-to-one WhatsApp (→ whatsapp), the calendar and booking hours (→ agenda), therapy payments and general sales numbers (→ ventas).",
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
      "Contacts & team specialist. OWNS: CRM contacts (search, create, fix data, duplicates), importing from Google Contacts, e-mail to one person or many (templates, campaigns), SMS, uploading files to Drive, staff accounts and who did what (audit log). ASK IT FOR: «crea el contacto de Ana +57…», «mándale un correo a Paula», «envía un SMS a…», «¿quién cambió el precio?», «crea un usuario para Laura del equipo». NOT ITS JOB: WhatsApp messages and chats (→ whatsapp), calendar (→ agenda), payments (→ ventas), workshops and events (→ talleres).",
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
  /**
   * `false`: only the panel agents, never the MCP server. For tools that shape
   * the owner's own assistant (its memory): a token or an external agent must
   * not be able to plant rules in it.
   */
  mcp?: false;
};

const ALL: AgentId[] = ["auto", ...SPECIALIST_IDS];

export const TOOL_CATALOG = {
  // ── shared reads ────────────────────────────────────────────────────────
  search_contacts: { access: "read", agents: ALL, label: "Buscar contactos" },
  get_contact: { access: "read", agents: ALL, label: "Ver contacto" },
  memory: { access: "edit", agents: ALL, label: "Memoria", mcp: false },
  message_owner: { access: "execute", agents: ALL, label: "Escribirle a Dayana" },
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
  whatsapp_update_config: { access: "execute", agents: ["whatsapp", "agenda"], label: "Cambiar configuración de la IA" },
  booking_set_day_hours: { access: "execute", agents: ["agenda", "whatsapp"], label: "Horario de un día" },
  whatsapp_list_playbooks: { access: "read", agents: ["whatsapp"], label: "Guiones de la IA" },
  whatsapp_save_playbook: { access: "execute", agents: ["whatsapp"], label: "Guardar guion de la IA" },
  whatsapp_set_chat: { access: "execute", agents: ["whatsapp"], label: "Cambiar quién atiende el chat" },
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
  create_calendar_event: { access: "execute", agents: ["agenda"], label: "Crear evento" },
  update_calendar_event: { access: "execute", agents: ["agenda"], label: "Mover evento" },

  // ── talleres ────────────────────────────────────────────────────────────
  list_workshop_editions: { access: "read", agents: ["talleres", "auto"], label: "Talleres" },
  get_workshop_edition: { access: "read", agents: ["talleres"], label: "Ver taller" },
  list_workshop_enrollees: { access: "read", agents: ["talleres", "auto"], label: "Inscritas e interesadas del taller" },
  create_workshop: { access: "execute", agents: ["talleres"], label: "Crear taller" },
  update_workshop: { access: "execute", agents: ["talleres"], label: "Editar taller" },
  create_workshop_product: { access: "execute", agents: ["talleres"], label: "Crear producto del taller" },
  list_workshop_documents: { access: "read", agents: ["talleres"], label: "Documentos del taller" },
  get_free_webinar: { access: "read", agents: ["talleres"], label: "Ver evento gratuito" },
  list_free_event_registrations: { access: "read", agents: ["talleres", "auto"], label: "Inscritas al evento gratuito" },
  update_free_webinar: { access: "execute", agents: ["talleres"], label: "Editar evento gratuito" },
  deactivate_free_webinar: { access: "execute", agents: ["talleres"], label: "Cerrar evento gratuito" },

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
