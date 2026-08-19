import { NextRequest, NextResponse } from "next/server";

import { createDiagnostic } from "@/lib/crm/diagnostics";
import {
  clientIp,
  rateLimitDistributed,
} from "@/lib/api/rate-limit-distributed";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Abre una sesión del cuestionario y devuelve su token.
 *
 * La fila nace vacía y anónima. Eso significa que este endpoint crea basura
 * para cualquiera que abra `/diagnostico` y se vaya — y es exactamente lo que
 * se quiere: sin fila no hay denominador y el abandono por pregunta deja de
 * ser medible. El límite de peticiones es lo que acota el coste.
 */
export async function POST(req: NextRequest) {
  const ip = clientIp(req);
  const rl = await rateLimitDistributed(`diagnostico:new:${ip}`, 10, 60_000);
  if (!rl.ok) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  let source: string | null = null;
  try {
    const body = (await req.json()) as { source?: unknown };
    if (typeof body.source === "string") source = body.source;
  } catch {
    // Cuerpo vacío es válido: `source` es opcional.
  }

  try {
    const diagnostic = await createDiagnostic(source);
    return NextResponse.json({ ok: true, token: diagnostic.token });
  } catch (e) {
    console.error("[diagnostico] create failed", e);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
