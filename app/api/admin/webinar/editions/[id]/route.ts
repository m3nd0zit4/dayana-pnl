import { withStaff } from "@/lib/api/handler";
import { deleteEventResponse } from "@/app/api/admin/eventos/_lib/lifecycle";

export const dynamic = "force-dynamic";

type Params = { id: string };

/**
 * Ruta de antes: borrar una edición. Ahora con la regla de las ediciones: solo
 * un evento sin inscritas y sin publicar (con inscritas es historia y se
 * queda). Ver `DELETE /api/admin/eventos/[id]`.
 */
export const DELETE = withStaff<Params>("owner", async ({ staff, params }) =>
  deleteEventResponse(params.id, staff.id)
);
