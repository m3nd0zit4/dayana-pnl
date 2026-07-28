import { notFound } from "next/navigation";
import InboxPageClient from "@/app/components/admin/crm/inbox/InboxPageClient";
import {
  toDetailView,
  toListItem,
} from "@/app/components/admin/crm/inbox/serialize";
import { getStaffSession } from "@/lib/auth/staff-session";
import { getConversation, listConversations } from "@/lib/crm/conversations";
import { isMetaInboxEnabled } from "@/lib/meta/client";
import { loadAssignableStaff } from "../page";

export const dynamic = "force-dynamic";

/**
 * Enlace profundo a un hilo.
 *
 * Existe porque cada notificación de mensaje nuevo apunta a
 * `/admin/inbox/<id>`: sin esta ruta, todas las notificaciones de la campana
 * llevaban a un 404.
 */
const InboxThreadPage = async ({
  params,
}: {
  params: Promise<{ id: string }>;
}) => {
  if (!isMetaInboxEnabled()) notFound();

  const staffSession = await getStaffSession();
  if (!staffSession) return null;

  const { id } = await params;

  const [{ items, nextCursor }, conversation, staff] = await Promise.all([
    listConversations(),
    getConversation(id),
    loadAssignableStaff(),
  ]);

  if (!conversation) notFound();

  return (
    <InboxPageClient
      initialItems={items.map(toListItem)}
      initialCursor={nextCursor}
      initialSelectedId={id}
      // Resuelto en el servidor: entrar por el enlace de una notificación pinta
      // el hilo directamente, sin un salto de carga en el cliente.
      initialDetail={toDetailView(conversation)}
      staff={staff}
    />
  );
};

export default InboxThreadPage;
