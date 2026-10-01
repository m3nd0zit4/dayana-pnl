import { NextResponse } from "next/server";
import { apiError, withStaff } from "@/lib/api/handler";
import { fireAuditLog } from "@/lib/crm/audit";
import { listFreeEvents } from "@/lib/crm/free-events";
import { duplicateFreeEvent, ensureFreeWebinar } from "@/lib/crm/free-webinar";
import { freeEventEditionsEnabled } from "@/lib/crm/free-event-settings";

export const dynamic = "force-dynamic";

/**
 * Ruta de antes del historial por renombre. Ahora cada evento es su propia
 * fila (`/api/admin/eventos`); esto sigue respondiendo con la forma vieja.
 *
 * GET: los eventos que no son el actual.
 */
export const GET = withStaff("read", async () => {
  const editions = (await listFreeEvents())
    .filter((e) => !e.isCurrent)
    .map((e) => ({
      id: e.id,
      startsAt: e.startsAt,
      startsAtHasTime: e.startsAtHasTime,
      archivedAt: null,
      endedAt: e.endedAt,
      headline: e.headline,
      meetUrl: e.meetUrl,
      registrations: e.registrations,
    }));
  return NextResponse.json({ editions });
});

/**
 * «Archivar» de antes: el evento actual ya terminado se queda como está (es su
 * propia fila) y se prepara uno nuevo con su página — lo mismo que «Duplicar».
 */
export const POST = withStaff("write", async ({ staff }) => {
  if (!(await freeEventEditionsEnabled())) return apiError("editions_disabled", 403);
  const current = await ensureFreeWebinar();
  if (!current.startsAt) {
    return apiError("nothing_to_archive", 400, {
      message: "No hay nada que archivar: esta edición no tiene fecha.",
    });
  }
  if (!current.endedAt) {
    return apiError("not_ended", 400, {
      message: "El webinar todavía no ha terminado. Ciérralo antes de archivarlo.",
    });
  }
  const live = await duplicateFreeEvent(current.id, { staffUserId: staff.id });
  fireAuditLog({
    staffUserId: staff.id,
    action: "CREATE",
    entityType: "FreeWebinar",
    entityId: live.id,
    changes: { copiedFrom: current.id },
  });
  return NextResponse.json({ archived: current, live });
});
