import { withStaff } from "@/lib/api/handler";
import { getRegistrations } from "@/app/api/admin/eventos/_lib/handlers";

export const dynamic = "force-dynamic";

/**
 * Ruta de antes: inscritas del evento actual, o de `?webinarId=`. Ver
 * `/api/admin/eventos/[id]/registrations`.
 */
export const GET = withStaff("read", async (ctx) => getRegistrations(ctx));
