import { NextRequest, NextResponse } from "next/server";
import { PaymentProvider, PaymentStatus } from "@prisma/client";
import {
  recordPayment,
  registerWebhookEvent,
  resolveEnrollmentFromReference,
} from "@/lib/crm/payments";
import { verifyPayPalWebhook } from "@/lib/webhooks/verify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  if (!(await verifyPayPalWebhook(req, rawBody))) {
    return NextResponse.json({ error: "invalid_signature" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    body = null;
  }
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const payload = body as {
    id?: string;
    event_type?: string;
    resource?: {
      id?: string;
      status?: string;
      custom_id?: string;
      purchase_units?: Array<{
        reference_id?: string;
        payments?: {
          captures?: Array<{
            id?: string;
            status?: string;
            amount?: { currency_code?: string; value?: string };
          }>;
        };
      }>;
    };
  };

  const eventId = payload.id ?? `paypal-${Date.now()}`;
  const isNew = await registerWebhookEvent(
    PaymentProvider.PAYPAL,
    eventId,
    payload
  );
  if (!isNew) {
    return NextResponse.json({ ok: true, duplicate: true });
  }

  const resource = payload.resource;
  const reference =
    resource?.custom_id ??
    resource?.purchase_units?.[0]?.reference_id;
  const capture = resource?.purchase_units?.[0]?.payments?.captures?.[0];

  if (!reference || !capture?.id) {
    return NextResponse.json({ ok: true, skipped: true });
  }

  const enrollmentId = await resolveEnrollmentFromReference(reference);
  if (!enrollmentId) {
    return NextResponse.json({ ok: true, enrollment_not_found: true });
  }

  const approved =
    capture.status === "COMPLETED" ||
    resource?.status === "COMPLETED";
  const failed =
    capture.status === "DECLINED" ||
    capture.status === "FAILED" ||
    resource?.status === "VOIDED";

  const amountValue = Number(capture.amount?.value ?? 0);
  const amountMinor = Math.round(amountValue * 100);

  try {
    await recordPayment({
      enrollmentId,
      provider: PaymentProvider.PAYPAL,
      providerPaymentId: capture.id,
      providerOrderId: resource?.id,
      status: approved
        ? PaymentStatus.APPROVED
        : failed
          ? PaymentStatus.FAILED
          : PaymentStatus.PENDING,
      currency: capture.amount?.currency_code ?? "USD",
      amountMinor,
      rawPayload: payload,
      paidAt: approved ? new Date() : undefined,
    });

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[webhook paypal]", e);
    return NextResponse.json({ error: "processing_failed" }, { status: 500 });
  }
}
