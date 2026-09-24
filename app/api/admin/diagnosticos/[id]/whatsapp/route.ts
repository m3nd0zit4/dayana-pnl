import { NextResponse } from "next/server";

import { withStaff } from "@/lib/api/handler";
import { runDiagnosticOutreach } from "@/lib/crm/diagnostic-outreach";

export const dynamic = "force-dynamic";
// Leer la autoevaluación con la IA y enviar cabe de sobra en un minuto.
export const maxDuration = 60;

type Params = { id: string };

/**
 * «Escribirle ahora»: vuelve a leer la autoevaluación y le escribe ya, sin
 * pasar por la aprobación (quien pulsa el botón es Dayana).
 */
export const POST = withStaff<Params>("write", async ({ params, staff }) =>
  NextResponse.json(await runDiagnosticOutreach(params.id, { force: true, staffId: staff.id }))
);
