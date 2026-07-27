/**
 * Contrato entre el servidor y la interfaz de la bandeja.
 *
 * Las fechas viajan como ISO strings, igual que en el feed de notificaciones —
 * lo que cruza la red nunca es un `Date`.
 */

export type InboxChannel = "WHATSAPP" | "MESSENGER" | "INSTAGRAM";

export const CHANNEL_LABEL: Record<InboxChannel, string> = {
  WHATSAPP: "WhatsApp",
  MESSENGER: "Messenger",
  INSTAGRAM: "Instagram",
};

export type ConversationContact = {
  id: string;
  firstName: string;
  lastName: string | null;
  displayName: string | null;
  phoneE164?: string;
  email?: string | null;
};

export type ConversationListItem = {
  id: string;
  channel: InboxChannel;
  status: "OPEN" | "PENDING" | "CLOSED";
  participantName: string | null;
  participantHandle: string | null;
  externalThreadId: string;
  lastMessageAt: string;
  unreadCount: number;
  contact: ConversationContact | null;
  assignedStaff: { id: string; displayName: string } | null;
  messages: { body: string | null; direction: string; sentAt: string }[];
};

export type ConversationMessageView = {
  id: string;
  direction: "INBOUND" | "OUTBOUND";
  status: string;
  body: string | null;
  failedReason: string | null;
  sentAt: string;
  isEcho: boolean;
  staffUser: { id: string; displayName: string } | null;
};

export type WindowView = {
  isOpen: boolean;
  requirement: "free" | "template" | "human_agent" | "closed";
};

export type ConversationDetailView = {
  id: string;
  channel: InboxChannel;
  status: "OPEN" | "PENDING" | "CLOSED";
  participantName: string | null;
  externalThreadId: string;
  unreadCount: number;
  draftBody: string | null;
  draftSource: string | null;
  contact: ConversationContact | null;
  messages: ConversationMessageView[];
  window: WindowView;
  windowNotice: string | null;
};
