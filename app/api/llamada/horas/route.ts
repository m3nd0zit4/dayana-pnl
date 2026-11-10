import { NextRequest, NextResponse } from "next/server";

import { clientIp, rateLimitDistributed } from "@/lib/api/rate-limit-distributed";
import { funnelSlots } from "@/lib/crm/call-funnel/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Las horas libres que la página de la llamada gratis muestra ahora mismo.
 * Nunca se guardan: se calculan del calendario de Dayana en cada pedido (una
 * rejilla guardada queda vieja en cuanto ella apunta algo desde el celular).
 */
export async function GET(req: NextRequest) {
  const rl = await rateLimitDistributed(`llamada-horas:${clientIp(req)}`, 30, 60_000);
  if (!rl.ok) return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  try {
    const result = await funnelSlots();
    if (result.state !== "ok") return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
    return NextResponse.json(
      {
        state: "ok",
        slots: result.slots.map((s) => ({ startIso: s.startIso, endIso: s.endIso })),
        minutes: result.minutes,
        dayanaTz: result.dayanaTz,
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (e) {
    console.error("[llamada-web] horas", e);
    return NextResponse.json({ state: "unavailable", reason: "calendar" }, { headers: { "Cache-Control": "no-store" } });
  }
}
