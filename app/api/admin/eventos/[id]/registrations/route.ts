import { withStaff } from "@/lib/api/handler";
import { getRegistrations } from "../../_lib/handlers";

export const dynamic = "force-dynamic";

/** Inscritas del evento, paginadas, con búsqueda y «solo fallidas». */
export const GET = withStaff<{ id: string }>("read", async (ctx) => getRegistrations(ctx, ctx.params.id));
