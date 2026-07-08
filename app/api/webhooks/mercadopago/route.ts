import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { PaymentProvider } from "@prisma/client";
import { registerWebhookEvent } from "@/lib/crm/payments";
import { syncMercadoPagoPayment } from "@/lib/crm/mercadopago-payments";
import { verifyMercadoPagoWebhook } from "@/lib/webhooks/verify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  if (!verifyMercadoPagoWebhook(req, rawBody)) {
    return NextResponse.json({ error: "invalid_signature" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const payload = body as {
    id?: number | string;
    type?: string;
    action?: string;
    data?: { id?: string };
  };

  const paymentId = payload.data?.id;
  if (!paymentId) {
    return NextResponse.json({ ok: true, skipped: true });
  }

  const eventId = String(payload.id ?? `${payload.type}-${paymentId}`);

  // Mercado Pago's webhook delivery times out fast and marks a slow response
  // as "Falla en entrega" (502) even if we'd have succeeded a moment later —
  // that silently dropped every payment that hit a cold start. Acknowledge
  // immediately; do the actual DB writes + the callback fetch to MP's own
  // Payments API afterward. `after()` extends the Vercel function's lifetime
  // via waitUntil, so this still runs to completion.
  after(async () => {
    try {
      const isNew = await registerWebhookEvent(
        PaymentProvider.MERCADO_PAGO,
        eventId,
        payload
      );
      if (!isNew) return;

      await syncMercadoPagoPayment(String(paymentId));
    } catch (e) {
      console.error("[webhook mercadopago]", e);
    }
  });

  return NextResponse.json({ ok: true });
}
