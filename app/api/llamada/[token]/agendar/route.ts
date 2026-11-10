import { NextRequest, NextResponse } from "next/server";

import { clientIp, rateLimitDistributed } from "@/lib/api/rate-limit-distributed";
import { bookCall, type BookResult } from "@/lib/crm/call-funnel/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ token: string }> };

const STATUS: Record<BookResult["status"], number> = {
  booked: 200,
  unavailable: 409,
  already_booked: 409,
  closed: 503,
  not_found: 404,
};

/**
 * Paso 3 del embudo de la llamada gratis: agenda la hora elegida (o la cambia,
 * si este enlace ya tenía su llamada).
 *
 * El formulario es público y nadie comprueba que el número sea de quien lo
 * escribe, así que una misma conexión solo puede agendar unas pocas llamadas
 * al día (`bookCall` las cuenta por la huella de la conexión): sin ese tope,
 * alguien podría llenar el cupo diario de Dayana con números inventados.
 */
export async function POST(req: NextRequest, ctx: Ctx) {
  const ip = clientIp(req);
  const burst = await rateLimitDistributed(`llamada-agendar:${ip}`, 10, 60_000);
  if (!burst.ok) return NextResponse.json({ error: "rate_limited" }, { status: 429 });

  let startIso: unknown;
  try {
    startIso = ((await req.json()) as { startIso?: unknown } | null)?.startIso;
  } catch {
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  }
  if (typeof startIso !== "string" || !Number.isFinite(Date.parse(startIso))) {
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  }

  const { token } = await ctx.params;
  try {
    const result = await bookCall(token, startIso, { ip });
    return NextResponse.json(result, { status: STATUS[result.status] });
  } catch (e) {
    console.error("[llamada-web] paso 3", e);
    return NextResponse.json({ status: "closed" }, { status: 503 });
  }
}
