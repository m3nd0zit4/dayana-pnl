import { NextResponse } from "next/server";

import { markPaymentLinkCheckoutStarted } from "@/lib/crm/payment-links";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Sella `checkoutStartedAt` del enlace. Es telemetría: siempre responde 200
 * aunque falle, para no teñir de rojo la consola de quien está pagando.
 */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  try {
    await markPaymentLinkCheckoutStarted(token);
  } catch (e) {
    console.error("[pagar] checkout mark failed", e);
  }
  return NextResponse.json({ ok: true });
}
