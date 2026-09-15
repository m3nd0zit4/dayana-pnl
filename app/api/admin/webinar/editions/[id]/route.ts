import { NextResponse } from "next/server";
import { apiError, withStaff } from "@/lib/api/handler";
import { fireAuditLog } from "@/lib/crm/audit";
import { deleteArchivedWebinar } from "@/lib/crm/free-webinar";

export const dynamic = "force-dynamic";

type Params = { id: string };

/**
 * Borra una edición archivada y, en cascada, su lista de registradas.
 *
 * Es destructivo e irreversible, así que OWNER. `deleteArchivedWebinar` filtra
 * por `slug != gratuito`: la edición viva no se puede borrar por aquí ni
 * pasando su id a mano.
 */
export const DELETE = withStaff<Params>("owner", async ({ staff, params }) => {
  const { id } = params;
  const count = await deleteArchivedWebinar(id);
  if (count === 0) {
    return apiError("not_archived", 400, {
      message: "Solo se pueden borrar ediciones ya archivadas.",
    });
  }

  fireAuditLog({
    staffUserId: staff.id,
    action: "DELETE",
    entityType: "FreeWebinar",
    entityId: id,
    changes: { deletedArchivedEdition: true },
  });

  return NextResponse.json({ ok: true });
});
