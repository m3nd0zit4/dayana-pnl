import { NextResponse } from "next/server";
import type {
  ConversationChannel,
  ConversationStatus,
} from "@prisma/client";
import { toListItem } from "@/app/components/admin/crm/inbox/serialize";
import { resolveAdminStaff } from "@/lib/auth/api-staff";
import { listConversations } from "@/lib/crm/conversations";
import { isMetaInboxEnabled } from "@/lib/meta/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CHANNELS = new Set<ConversationChannel>([
  "WHATSAPP",
  "MESSENGER",
  "INSTAGRAM",
]);
const STATUSES = new Set<ConversationStatus>(["OPEN", "PENDING", "CLOSED"]);

export const GET = async (req: Request) => {
  if (!isMetaInboxEnabled()) {
    return NextResponse.json({ error: "inbox_disabled" }, { status: 404 });
  }

  const staff = await resolveAdminStaff();
  if (staff instanceof NextResponse) return staff;

  const url = new URL(req.url);
  const channel = url.searchParams.get("channel");
  const status = url.searchParams.get("status");
  const assigned = url.searchParams.get("assigned");

  const { items, nextCursor } = await listConversations({
    channel:
      channel && CHANNELS.has(channel as ConversationChannel)
        ? (channel as ConversationChannel)
        : undefined,
    status:
      status && STATUSES.has(status as ConversationStatus)
        ? (status as ConversationStatus)
        : undefined,
    // `assigned=me` se resuelve en el servidor: el cliente no debería poder
    // pedir la bandeja de otra persona pasando un id cualquiera.
    assignedStaffId: assigned === "me" ? staff.id : undefined,
    unlinkedOnly: url.searchParams.get("unlinked") === "1",
    search: url.searchParams.get("q")?.trim() || undefined,
    cursor: url.searchParams.get("cursor") ?? undefined,
  });

  return NextResponse.json({ items: items.map(toListItem), nextCursor });
};
