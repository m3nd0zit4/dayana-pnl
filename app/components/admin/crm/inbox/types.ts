/**
 * Contrato entre el servidor y la interfaz de la bandeja.
 *
 * Las fechas viajan como ISO strings, igual que en el feed de notificaciones —
 * lo que cruza la red nunca es un `Date`.
 */

export type InboxChannel = "WHATSAPP" | "MESSENGER" | "INSTAGRAM";
export type InboxStatus = "OPEN" | "PENDING" | "CLOSED";

export const CHANNEL_LABEL: Record<InboxChannel, string> = {
  WHATSAPP: "WhatsApp",
  MESSENGER: "Messenger",
  INSTAGRAM: "Instagram",
};

export const STATUS_LABEL: Record<InboxStatus, string> = {
  OPEN: "Abierta",
  PENDING: "Esperando",
  CLOSED: "Cerrada",
};

export type ConversationContact = {
  id: string;
  firstName: string;
  lastName: string | null;
  displayName: string | null;
  phoneE164?: string;
  email?: string | null;
};

export type StaffRef = { id: string; displayName: string };

export type ConversationListItem = {
  id: string;
  channel: InboxChannel;
  status: InboxStatus;
  participantName: string | null;
  participantHandle: string | null;
  participantAvatarUrl: string | null;
  externalThreadId: string;
  lastMessageAt: string;
  unreadCount: number;
  contact: ConversationContact | null;
  assignedStaff: StaffRef | null;
  lastMessage: { body: string | null; direction: string } | null;
};

/** Adjunto ya rehospedado en Blob; `url` es null si la rehospedación falló. */
export type MessageAttachment = {
  kind: string;
  url: string | null;
  mimeType: string | null;
  caption: string | null;
  unavailableReason?: string;
};

export type ConversationMessageView = {
  id: string;
  direction: "INBOUND" | "OUTBOUND";
  status: string;
  body: string | null;
  attachments: MessageAttachment[];
  failedReason: string | null;
  sentAt: string;
  isEcho: boolean;
  staffUser: StaffRef | null;
};

export type WindowRequirement = "free" | "template" | "human_agent" | "closed";

export type WindowView = {
  isOpen: boolean;
  requirement: WindowRequirement;
  expiresAt: string | null;
};

/** Plantilla aprobada por Meta, la única vía fuera de la ventana de 24 h. */
export type WhatsAppTemplateOption = {
  id: string;
  title: string;
  name: string;
  language: string;
  body: string;
};

export type ConversationDetailView = {
  id: string;
  channel: InboxChannel;
  status: InboxStatus;
  participantName: string | null;
  participantAvatarUrl: string | null;
  externalThreadId: string;
  unreadCount: number;
  draftBody: string | null;
  draftSource: string | null;
  contact: ConversationContact | null;
  assignedStaff: StaffRef | null;
  messages: ConversationMessageView[];
  window: WindowView;
  windowNotice: string | null;
  /** Vacío dentro de la ventana; solo se resuelven cuando hacen falta. */
  templates: WhatsAppTemplateOption[];
};

export type InboxFilters = {
  channel: InboxChannel | "ALL";
  status: InboxStatus | "ALL";
  assignedToMe: boolean;
  unlinkedOnly: boolean;
  search: string;
};

export const EMPTY_FILTERS: InboxFilters = {
  channel: "ALL",
  status: "ALL",
  assignedToMe: false,
  unlinkedOnly: false,
  search: "",
};

/** Traduce los códigos del API a algo que un operador pueda leer. */
export const INBOX_ERROR_MESSAGE: Record<string, string> = {
  empty_message: "Escribe un mensaje antes de enviar.",
  missing_contact: "Elige un contacto para vincular.",
  unknown_action: "Esa acción no existe.",
  not_found: "La conversación ya no existe.",
  inbox_disabled: "La bandeja está desactivada.",
  read_only: "Tu rol no permite responder.",
  missing_file: "Elige un archivo primero.",
  unsupported_type: "Ese tipo de archivo no se puede enviar por esta vía.",
  file_too_large: "El archivo pesa más de lo que permite Meta para ese tipo.",
  upload_failed: "No se pudo subir el archivo. Intenta de nuevo.",
  blob_not_configured: "El almacenamiento de archivos no está configurado.",
};

export const humanizeInboxError = (code: string | undefined): string =>
  (code && INBOX_ERROR_MESSAGE[code]) ||
  code ||
  "No se pudo completar la acción.";
