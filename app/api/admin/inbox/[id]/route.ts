import { NextResponse } from "next/server";
import { resolveAdminStaff, requireWriteStaff } from "@/lib/auth/api-staff";
import {
  assignConversation,
  getConversation,
  linkConversationToContact,
  markConversationRead,
  saveConversationDraft,
  setConversationStatus,
} from "@/lib/crm/conversations";
import { isMetaInboxEnabled } from "@/lib/meta/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export const GET = async (_req: Request, { params }: Params) => {
  if (!isMetaInboxEnabled()) {
    return NextResponse.json({ error: "inbox_disabled" }, { status: 404 });
  }

  const staff = await resolveAdminStaff();
  if (staff instanceof NextResponse) return staff;

  const { id } = await params;
  const conversation = await getConversation(id);
  if (!conversation) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  // Abrir el hilo lo marca leído. Solo para quien puede responder: un rol de
  // solo lectura mirando la bandeja no debe apagar el aviso para los demás.
  if (conversation.unreadCount > 0 && staff.role !== "READONLY") {
    await markConversationRead(id);
  }

  return NextResponse.json(conversation);
};

/** Acciones sobre el hilo: asignar, cambiar estado, vincular contacto, borrador. */
export const PATCH = async (req: Request, { params }: Params) => {
  if (!isMetaInboxEnabled()) {
    return NextResponse.json({ error: "inbox_disabled" }, { status: 404 });
  }

  const staff = await requireWriteStaff();
  if (staff instanceof NextResponse) return staff;

  const { id } = await params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const input = body as {
    action?: string;
    status?: "OPEN" | "PENDING" | "CLOSED";
    assignedStaffId?: string | null;
    contactId?: string;
    draft?: string | null;
  };

  try {
    switch (input.action) {
      case "assign":
        return NextResponse.json(
          await assignConversation(id, input.assignedStaffId ?? null, staff.id)
        );
      case "status": {
        if (!input.status) {
          return NextResponse.json({ error: "missing_status" }, { status: 400 });
        }
        return NextResponse.json(
          await setConversationStatus(id, input.status, staff.id)
        );
      }
      case "link": {
        if (!input.contactId) {
          return NextResponse.json({ error: "missing_contact" }, { status: 400 });
        }
        return NextResponse.json(
          await linkConversationToContact(id, input.contactId, staff.id)
        );
      }
      case "draft":
        return NextResponse.json(
          await saveConversationDraft(id, input.draft ?? null, "STAFF")
        );
      case "read":
        return NextResponse.json(await markConversationRead(id));
      default:
        return NextResponse.json({ error: "unknown_action" }, { status: 400 });
    }
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "action_failed" },
      { status: 400 }
    );
  }
};
