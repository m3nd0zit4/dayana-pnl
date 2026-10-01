import { withStaff } from "@/lib/api/handler";
import { getEvent, patchEvent } from "../_lib/handlers";
import { deleteEventResponse } from "../_lib/lifecycle";

export const dynamic = "force-dynamic";

type Params = { id: string };

export const GET = withStaff<Params>("read", async ({ params }) => getEvent(params.id));

/** Guardar la página. `isActive` publica o cierra inscripciones; `ended` termina o reabre. */
export const PATCH = withStaff<Params>("write", async (ctx) => patchEvent(ctx, ctx.params.id));

/** Solo sin inscritas y sin publicar: con inscritas, el evento es historia. */
export const DELETE = withStaff<Params>("write", async ({ staff, params }) =>
  deleteEventResponse(params.id, staff.id)
);
