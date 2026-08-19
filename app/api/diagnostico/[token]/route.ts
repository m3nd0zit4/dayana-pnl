import { NextRequest, NextResponse } from "next/server";

import { patchDiagnosticAnswers } from "@/lib/crm/diagnostics";
import {
  clientIp,
  rateLimitDistributed,
} from "@/lib/api/rate-limit-distributed";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Guarda un paso del cuestionario.
 *
 * El límite es más alto que el de creación porque un cuestionario completo son
 * ocho llamadas legítimas, y volver atrás a corregir suma más.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;

  const ip = clientIp(req);
  const rl = await rateLimitDistributed(`diagnostico:patch:${ip}`, 60, 60_000);
  if (!rl.ok) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  let answers: unknown;
  try {
    const body = (await req.json()) as { answers?: unknown };
    answers = body.answers;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  try {
    const row = await patchDiagnosticAnswers(token, answers);
    // `null` cubre dos casos —token inexistente y cuestionario ya cerrado— y
    // los dos se responden igual a propósito: que el token sea válido o no es
    // justo lo que no conviene decirle a quien está probando tokens.
    if (!row) return NextResponse.json({ error: "not_found" }, { status: 404 });

    return NextResponse.json({ ok: true, answers: row.answers });
  } catch (e) {
    console.error("[diagnostico] patch failed", e);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
