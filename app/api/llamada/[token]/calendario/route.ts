import { NextRequest, NextResponse } from "next/server";

import { clientIp, rateLimitDistributed } from "@/lib/api/rate-limit-distributed";
import { buildIcs } from "@/lib/crm/call-funnel/rules";
import { getCallForIcs } from "@/lib/crm/call-funnel/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ token: string }> };

/** El archivo .ics de la llamada (Apple Calendar, Outlook), con aviso 30 minutos antes. */
export async function GET(req: NextRequest, ctx: Ctx) {
  const rl = await rateLimitDistributed(`llamada-ics:${clientIp(req)}`, 20, 60_000);
  if (!rl.ok) return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  const { token } = await ctx.params;
  const call = await getCallForIcs(token).catch(() => null);
  if (!call) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return new NextResponse(buildIcs({ ...call, now: new Date() }), {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'attachment; filename="llamada-con-dayana.ics"',
      "Cache-Control": "no-store",
    },
  });
}
