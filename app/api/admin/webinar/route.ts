import { withStaff } from "@/lib/api/handler";
import { getEvent, patchEvent } from "@/app/api/admin/eventos/_lib/handlers";

export const dynamic = "force-dynamic";

/**
 * Ruta de antes (una sola edición viva). Sigue sirviendo, sobre el evento
 * actual, a lo que todavía la llame; el panel usa `/api/admin/eventos/[id]`.
 */
export const GET = withStaff("read", async () => getEvent());

export const PATCH = withStaff("write", async (ctx) => patchEvent(ctx));
