import { notFound } from "next/navigation";
import InboxPageClient from "@/app/components/admin/crm/inbox/InboxPageClient";
import type { ConversationListItem } from "@/app/components/admin/crm/inbox/types";
import { getStaffSession } from "@/lib/auth/staff-session";
import { listConversations } from "@/lib/crm/conversations";
import { canWriteCrm } from "@/lib/crm/staff-permissions";
import { isMetaInboxEnabled } from "@/lib/meta/client";

export const dynamic = "force-dynamic";

const InboxPage = async () => {
  // La bandeja no tiene modo vista previa: sin credenciales de Meta no hay nada
  // que enseñar, y los hilos son datos reales de clientes.
  if (!isMetaInboxEnabled()) notFound();

  const staff = await getStaffSession();
  if (!staff) return null;

  const { items, nextCursor } = await listConversations();

  const initialItems: ConversationListItem[] = items.map((item) => ({
    id: item.id,
    channel: item.channel,
    status: item.status,
    participantName: item.participantName,
    participantHandle: item.participantHandle,
    externalThreadId: item.externalThreadId,
    lastMessageAt: item.lastMessageAt.toISOString(),
    unreadCount: item.unreadCount,
    contact: item.contact,
    assignedStaff: item.assignedStaff,
    messages: item.messages.map((message) => ({
      body: message.body,
      direction: message.direction,
      sentAt: message.sentAt.toISOString(),
    })),
  }));

  return (
    <InboxPageClient
      initialItems={initialItems}
      initialCursor={nextCursor}
      canWrite={canWriteCrm(staff.role)}
      streamEnabled={process.env.NOTIFICATIONS_STREAM_ENABLED === "true"}
    />
  );
};

export default InboxPage;
