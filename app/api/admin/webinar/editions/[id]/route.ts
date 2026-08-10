import { NextRequest, NextResponse } from "next/server";
import { requireOwnerStaff } from "@/lib/auth/api-staff";
import { fireAuditLog } from "@/lib/crm/audit";
import { deleteArchivedWebinar } from "@/lib/crm/free-webinar";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ id: string }> };

/**
 * Borra una edición archivada y, en cascada, su lista de registradas.
 *
 * Es destructivo e irreversible, así que OWNER. `deleteArchivedWebinar` filtra
 * por `slug != gratuito`: la edición viva no se puede borrar por aquí ni
 * pasando su id a mano.
 */
export async function DELETE(_req: NextRequest, { params }: RouteParams) {
  const staff = await requireOwnerStaff();
  if (staff instanceof NextResponse) return staff;

  const { id } = await params;
  const count = await deleteArchivedWebinar(id);
  if (count === 0) {
    return NextResponse.json(
      {
        error: "not_archived",
        message: "Solo se pueden borrar ediciones ya archivadas.",
      },
      { status: 400 }
    );
  }

  fireAuditLog({
    staffUserId: staff.id,
    action: "DELETE",
    entityType: "FreeWebinar",
    entityId: id,
    changes: { deletedArchivedEdition: true },
  });

  return NextResponse.json({ ok: true });
}
