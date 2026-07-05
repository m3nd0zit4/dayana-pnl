import { NextRequest, NextResponse } from "next/server";
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

  const eventId = String(payload.id ?? `${payload.type}-${payload.data?.id ?? Date.now()}`);
  const isNew = await registerWebhookEvent(
    PaymentProvider.MERCADO_PAGO,
    eventId,
    payload
  );
  if (!isNew) {
    return NextResponse.json({ ok: true, duplicate: true });
  }

  const paymentId = payload.data?.id;
  if (!paymentId) {
    return NextResponse.json({ ok: true, skipped: true });
  }

  if (!process.env.MERCADOPAGO_ACCESS_TOKEN?.trim()) {
    return NextResponse.json({ error: "missing_token" }, { status: 503 });
  }

  try {
    const result = await syncMercadoPagoPayment(paymentId);
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    console.error("[webhook mercadopago]", e);
    return NextResponse.json({ error: "processing_failed" }, { status: 500 });
  }
}
