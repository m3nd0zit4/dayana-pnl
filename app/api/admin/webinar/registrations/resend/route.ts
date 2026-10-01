import type { NextRequest } from "next/server";
import { postResend } from "@/app/api/admin/eventos/_lib/handlers";

export const dynamic = "force-dynamic";

/**
 * Ruta de antes: reenvío de correos del evento actual. Ver
 * `/api/admin/eventos/[id]/registrations/resend`. Los permisos se comprueban
 * dentro: `all` es solo para OWNER.
 */
export async function POST(req: NextRequest) {
  return postResend(req);
}
