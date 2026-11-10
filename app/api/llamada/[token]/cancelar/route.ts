import { NextRequest, NextResponse } from "next/server";

import { clientIp, rateLimitDistributed } from "@/lib/api/rate-limit-distributed";
import { cancelCall, type CancelResult } from "@/lib/crm/call-funnel/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ token: string }> };

const STATUS: Record<CancelResult["status"], number> = { cancelled: 200, nothing: 200, closed: 503, not_found: 404 };

/** La persona cancela su llamada desde su página: sale del calendario de Dayana y se libera la hora. */
export async function POST(req: NextRequest, ctx: Ctx) {
  const rl = await rateLimitDistributed(`llamada-cancelar:${clientIp(req)}`, 10, 60_000);
  if (!rl.ok) return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  const { token } = await ctx.params;
  try {
    const result = await cancelCall(token);
    return NextResponse.json(result, { status: STATUS[result.status] });
  } catch (e) {
    console.error("[llamada-web] cancelar", e);
    return NextResponse.json({ status: "closed" }, { status: 503 });
  }
}
