import { NextRequest, NextResponse } from "next/server";
import { PaymentProvider, PaymentStatus } from "@prisma/client";
import {
  recordPayment,
  registerWebhookEvent,
  resolveEnrollmentFromReference,
} from "@/lib/crm/payments";
import { verifyMercadoPagoWebhook } from "@/lib/webhooks/verify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const getAccessToken = () => process.env.MERCADOPAGO_ACCESS_TOKEN?.trim();

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

  const token = getAccessToken();
  if (!token) {
    return NextResponse.json({ error: "missing_token" }, { status: 503 });
  }

  try {
    const res = await fetch(
      `https://api.mercadopago.com/v1/payments/${paymentId}`,
      {
        headers: { Authorization: `Bearer ${token}` },
      }
    );
    const payment = (await res.json()) as {
      id?: number;
      status?: string;
      external_reference?: string;
      transaction_amount?: number;
      currency_id?: string;
      payer?: { email?: string };
    };

    if (!payment.external_reference) {
      return NextResponse.json({ ok: true, skipped: true });
    }

    const enrollmentId = await resolveEnrollmentFromReference(
      payment.external_reference
    );
    if (!enrollmentId) {
      return NextResponse.json({ ok: true, enrollment_not_found: true });
    }

    const mpStatus = payment.status ?? "";
    const approved = mpStatus === "approved";
    const failed =
      mpStatus === "rejected" ||
      mpStatus === "cancelled" ||
      mpStatus === "charged_back";
    const amountMinor = Math.round((payment.transaction_amount ?? 0) * 100);

    await recordPayment({
      enrollmentId,
      provider: PaymentProvider.MERCADO_PAGO,
      providerPaymentId: String(payment.id ?? paymentId),
      status: approved
        ? PaymentStatus.APPROVED
        : failed
          ? PaymentStatus.FAILED
          : PaymentStatus.PENDING,
      currency: payment.currency_id ?? "USD",
      amountMinor,
      payerEmail: payment.payer?.email,
      rawPayload: payment,
      paidAt: approved ? new Date() : undefined,
    });

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[webhook mercadopago]", e);
    return NextResponse.json({ error: "processing_failed" }, { status: 500 });
  }
}
