import { NextResponse } from "next/server";
import { apiError, withStaff } from "@/lib/api/handler";
import { fireAuditLog } from "@/lib/crm/audit";
import {
  archiveFreeWebinar,
  FreeWebinarArchiveError,
  listArchivedWebinars,
} from "@/lib/crm/free-webinar";

export const dynamic = "force-dynamic";

/** Historial de ediciones. Solo CRM: no se publica en ninguna página. */
export const GET = withStaff("read", async () => {
  return NextResponse.json({ editions: await listArchivedWebinars() });
});

/**
 * Archiva la edición terminada y deja una nueva lista.
 *
 * Es la única acción manual del ciclo: el cron solo marca `endedAt`, nunca
 * archiva por su cuenta, para que nada se mueva de sitio sin que alguien lo
 * decida.
 */
export const POST = withStaff("write", async ({ staff }) => {
  try {
    const { archived, live } = await archiveFreeWebinar();

    fireAuditLog({
      staffUserId: staff.id,
      action: "UPDATE",
      entityType: "FreeWebinar",
      entityId: archived.id,
      changes: { archived: true, newEditionId: live.id },
    });

    return NextResponse.json({ archived, live });
  } catch (e) {
    if (e instanceof FreeWebinarArchiveError) {
      return apiError(e.reason, 400, {
        message:
          e.reason === "not_ended"
            ? "El webinar todavía no ha terminado. Ciérralo antes de archivarlo."
            : "No hay nada que archivar: esta edición no tiene fecha.",
      });
    }
    throw e;
  }
});
