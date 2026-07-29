import { notFound } from "next/navigation";
import InboxPageClient from "@/app/components/admin/crm/inbox/InboxPageClient";
import { toListItem } from "@/app/components/admin/crm/inbox/serialize";
import { getStaffSession } from "@/lib/auth/staff-session";
import { listConversations } from "@/lib/crm/conversations";
import { prisma } from "@/lib/db";
import { isMetaInboxEnabled } from "@/lib/meta/client";

export const dynamic = "force-dynamic";

/** El staff asignable se lee aquí para que el selector no haga otra petición. */
export const loadAssignableStaff = () =>
  prisma.staffUser.findMany({
    where: { isActive: true, role: { in: ["OWNER", "OPERATOR", "DEVELOPER"] } },
    orderBy: { displayName: "asc" },
    select: { id: true, displayName: true },
  });

const InboxPage = async () => {
  // La bandeja no tiene modo vista previa: sin credenciales de Meta no hay nada
  // que enseñar, y los hilos son datos reales de clientes.
  if (!isMetaInboxEnabled()) notFound();

  const staffSession = await getStaffSession();
  if (!staffSession) return null;

  const [{ items, nextCursor }, staff] = await Promise.all([
    listConversations(),
    loadAssignableStaff(),
  ]);

  return (
    <InboxPageClient
      initialItems={items.map(toListItem)}
      initialCursor={nextCursor}
      initialSelectedId={null}
      initialDetail={null}
      staff={staff}
    />
  );
};

export default InboxPage;
