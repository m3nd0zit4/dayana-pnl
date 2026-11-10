import { NextRequest, NextResponse } from "next/server";

import { clientIp, rateLimitDistributed } from "@/lib/api/rate-limit-distributed";
import { parseAnswersBody } from "@/lib/crm/call-funnel/rules";
import { saveAnswers } from "@/lib/crm/call-funnel/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ token: string }> };

/** Paso 2 del embudo de la llamada gratis: qué quiere trabajar y para cuándo. */
export async function POST(req: NextRequest, ctx: Ctx) {
  const rl = await rateLimitDistributed(`llamada-respuestas:${clientIp(req)}`, 20, 60_000);
  if (!rl.ok) return NextResponse.json({ error: "rate_limited" }, { status: 429 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  }
  const parsed = parseAnswersBody(body);
  if (!parsed.ok) return NextResponse.json({ error: "invalid" }, { status: 400 });

  const { token } = await ctx.params;
  try {
    const saved = await saveAnswers(token, parsed.value);
    return saved ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "not_found" }, { status: 404 });
  } catch (e) {
    console.error("[llamada-web] paso 2", e);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
