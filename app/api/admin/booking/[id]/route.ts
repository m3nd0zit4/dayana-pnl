import { NextResponse } from "next/server";

import { withStaff } from "@/lib/api/handler";
import { fireAuditLog } from "@/lib/crm/audit";
import { cancelAppointment } from "@/lib/crm/booking";

export const dynamic = "force-dynamic";

type Params = { id: string };

/** Cancelar desde el panel: libera el hueco y borra el evento del calendario. */
export const DELETE = withStaff<Params>("write", async ({ staff, params }) => {
  await cancelAppointment(params.id, "equipo");

  fireAuditLog({
    staffUserId: staff.id,
    action: "DELETE",
    entityType: "Appointment",
    entityId: params.id,
  });

  return NextResponse.json({ ok: true });
});
