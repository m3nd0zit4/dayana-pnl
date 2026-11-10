import { NextRequest, NextResponse } from "next/server";

import { clientIp, rateLimitDistributed } from "@/lib/api/rate-limit-distributed";
import { noteConfirmClick } from "@/lib/crm/call-funnel/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ token: string }> };

/**
 * La persona tocó «Confirmar por WhatsApp» en su página (lo manda
 * `navigator.sendBeacon`, sin esperar respuesta). Solo deja la marca: el
 * mensaje de verdad lo manda ella desde su WhatsApp.
 */
export async function POST(req: NextRequest, ctx: Ctx) {
  const rl = await rateLimitDistributed(`llamada-confirmar:${clientIp(req)}`, 20, 60_000);
  if (rl.ok) {
    const { token } = await ctx.params;
    await noteConfirmClick(token).catch((e: unknown) => console.warn("[llamada-web] confirmar", e));
  }
  return new NextResponse(null, { status: 204 });
}
