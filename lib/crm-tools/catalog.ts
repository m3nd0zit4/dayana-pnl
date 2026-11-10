/**
 * The one list of CRM tools: what each needs (`access`) and its Spanish name
 * (`label`). Pure data, no tool imports, so the MCP scopes (`lib/mcp/scopes.ts`)
 * can read it without pulling in every tool's server code. The definitions
 * are in `registry.ts`; `satisfies` there makes the two fail typecheck the
 * moment they disagree.
 *
 * `access` is what a token (and its owner's role) needs to see and call the
 * tool through MCP:
 * - `read`: looks, never changes anything.
 * - `edit`: changes CRM data that only the team sees (a contact, a draft, a
 *   workshop).
 * - `execute`: reaches outside the CRM or moves money — anything a client or
 *   the public sees (a public page, a Meet link, a calendar invite, how the
 *   WhatsApp AI answers clients), a WhatsApp/email/SMS that a real person
 *   receives, a payment, a site-wide price, a staff account.
 */

export type ToolAccess = "read" | "edit" | "execute";

type CatalogEntry = {
  access: ToolAccess;
  /** Spanish, sentence case: the tool's title for MCP clients. */
  label: string;
};

export const TOOL_CATALOG = {
  // ── general reads ────────────────────────────────────────────────────────
  search_contacts: { access: "read", label: "Buscar contactos" },
  get_contact: { access: "read", label: "Ver contacto" },
  crm_stats: { access: "read", label: "Estadísticas" },
  dashboard_stats: { access: "read", label: "Resumen del panel" },
  pending_tasks: { access: "read", label: "Pendientes" },
  list_products: { access: "read", label: "Productos" },
  get_enrollment: { access: "read", label: "Ver inscripción" },
  list_payments: { access: "read", label: "Pagos" },
  get_payment: { access: "read", label: "Ver pago" },
  list_notifications: { access: "read", label: "Mis notificaciones" },
  query_audit_log: { access: "read", label: "Historial de cambios" },
  convert_event_timezone: { access: "read", label: "Convertir horario" },

  // ── ventas ──────────────────────────────────────────────────────────────
  list_enrollments: { access: "read", label: "Inscripciones" },
  create_therapy_enrollment: { access: "edit", label: "Crear inscripción de terapia" },
  request_payment_otp: { access: "execute", label: "Pedir código de pago" },
  record_manual_payment: { access: "execute", label: "Registrar pago manual" },
  create_promo_code: { access: "edit", label: "Crear código promocional" },
  update_promo_code: { access: "edit", label: "Editar código promocional" },
  update_product_price: { access: "execute", label: "Cambiar precio" },
  update_usd_to_cop_rate: { access: "execute", label: "Cambiar tasa USD→COP" },
  list_payment_receipts: { access: "read", label: "Comprobantes por WhatsApp" },

  // ── whatsapp ────────────────────────────────────────────────────────────
  whatsapp_find_chat: { access: "read", label: "Buscar chats" },
  whatsapp_ai_status: { access: "read", label: "Estado de la IA de WhatsApp" },
  whatsapp_get_config: { access: "read", label: "Configuración de la IA" },
  whatsapp_update_config: { access: "execute", label: "Cambiar configuración de la IA" },
  booking_set_day_hours: { access: "execute", label: "Horario de un día" },
  whatsapp_list_playbooks: { access: "read", label: "Guiones de la IA" },
  whatsapp_save_playbook: { access: "execute", label: "Guardar guion de la IA" },
  whatsapp_set_chat: { access: "execute", label: "Cambiar quién atiende el chat" },
  whatsapp_simulate_reply: { access: "read", label: "Simular respuesta de la IA" },
  list_conversations: { access: "read", label: "Bandeja de entrada" },
  get_conversation: { access: "read", label: "Leer conversación" },
  list_whatsapp_messages: { access: "read", label: "Mensajes del chat" },
  list_ai_runs: { access: "read", label: "Ejecuciones de la IA" },
  draft_conversation_reply: { access: "edit", label: "Dejar borrador" },
  link_conversation_to_contact: { access: "edit", label: "Vincular chat a contacto" },
  list_message_templates: { access: "read", label: "Plantillas" },
  prepare_customer_whatsapp_message: { access: "edit", label: "Preparar enlace de WhatsApp" },
  send_whatsapp_to_contact: { access: "execute", label: "Enviar WhatsApp" },
  send_whatsapp_bulk: { access: "execute", label: "Envío masivo de WhatsApp" },

  // ── agenda ──────────────────────────────────────────────────────────────
  list_google_accounts: { access: "read", label: "Cuentas de Google" },
  list_calendar_events: { access: "read", label: "Ver calendario" },
  list_appointments: { access: "read", label: "Citas y reservas" },
  create_calendar_event: { access: "execute", label: "Crear evento" },
  update_calendar_event: { access: "execute", label: "Mover evento" },

  // ── talleres ────────────────────────────────────────────────────────────
  list_workshop_editions: { access: "read", label: "Talleres" },
  get_workshop_edition: { access: "read", label: "Ver taller" },
  list_workshop_enrollees: { access: "read", label: "Inscritas e interesadas del taller" },
  create_workshop: { access: "execute", label: "Crear taller" },
  update_workshop: { access: "execute", label: "Editar taller" },
  create_workshop_product: { access: "execute", label: "Crear producto del taller" },
  list_workshop_documents: { access: "read", label: "Documentos del taller" },
  get_free_webinar: { access: "read", label: "Ver evento gratuito" },
  list_free_event_registrations: { access: "read", label: "Inscritas al evento gratuito" },
  update_free_webinar: { access: "execute", label: "Editar evento gratuito" },
  deactivate_free_webinar: { access: "execute", label: "Cerrar evento gratuito" },

  // ── contactos ───────────────────────────────────────────────────────────
  create_contact: { access: "edit", label: "Crear contacto" },
  search_google_contacts: { access: "read", label: "Buscar en Google" },
  import_google_contact: { access: "edit", label: "Importar de Google" },
  send_contact_email: { access: "execute", label: "Enviar correo" },
  send_contact_template_email: { access: "execute", label: "Enviar plantilla por correo" },
  send_contact_sms: { access: "execute", label: "Enviar SMS" },
  send_bulk_email: { access: "execute", label: "Campaña de correo" },
  upload_drive_file: { access: "execute", label: "Subir a Drive" },
  create_staff_user: { access: "execute", label: "Crear usuario del equipo" },
} satisfies Record<string, CatalogEntry>;

export type ToolName = keyof typeof TOOL_CATALOG;

export const TOOL_NAMES = Object.keys(TOOL_CATALOG) as ToolName[];

export const isToolName = (name: string): name is ToolName => Object.hasOwn(TOOL_CATALOG, name);
