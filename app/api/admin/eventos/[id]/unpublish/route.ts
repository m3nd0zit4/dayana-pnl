import { withStaff } from "@/lib/api/handler";
import { unpublishEventResponse } from "../../_lib/lifecycle";

export const dynamic = "force-dynamic";

/** Cierra inscripciones: la página deja de aceptar registros; los avisos siguen. */
export const POST = withStaff<{ id: string }>("write", async ({ staff, params }) =>
  unpublishEventResponse(params.id, staff.id)
);
