import { NextRequest, NextResponse } from "next/server";
import { PaymentProvider, PaymentStatus } from "@prisma/client";
import {
  recordPayment,
  registerWebhookEvent,
  resolveEnrollmentFromReference,
} from "@/lib/crm/payments";
import { fulfillCheckoutPayment } from "@/lib/crm/checkout-fulfillment";
import { parseCheckoutReference } from "@/lib/crm/checkout-reference";
import { enrichContactFromPayer } from "@/lib/crm/contacts";
import { fireAuditLog } from "@/lib/crm/audit";
import { extractPayPalPayer } from "@/lib/crm/paypal-payer";
import { prisma } from "@/lib/db";
import { fireNotification } from "@/lib/notifications/platform/emit";
import { verifyPayPalWebhook } from "@/lib/webhooks/verify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  if (!(await verifyPayPalWebhook(req, rawBody))) {
    fireAuditLog({
      action: "WEBHOOK_REJECTED",
      entityType: "WebhookEvent",
      entityId: "paypal",
      changes: { reason: "invalid_signature" },
    });
    fireNotification({
      eventType: "PAYMENT_WEBHOOK_FAILED",
      title: "Webhook de PayPal rechazado por firma inválida",
      body: "PayPal reintentará el aviso; si persiste, revisa PAYPAL_WEBHOOK_ID.",
      href: "/admin/payments",
      metadata: { provider: "PAYPAL", reason: "invalid_signature" },
      staff: "ALL",
    });
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

  const approved =
    capture.status === "COMPLETED" ||
    resource?.status === "COMPLETED";
  const failed =
    capture.status === "DECLINED" ||
    capture.status === "FAILED" ||
    resource?.status === "VOIDED";

  const amountValue = Number(capture.amount?.value ?? 0);
  const amountMinor = Math.round(amountValue * 100);
  const payer = extractPayPalPayer(resource);
  const checkout = parseCheckoutReference(reference);

  try {
    if (checkout) {
      if (!approved) {
        return NextResponse.json({ ok: true, skipped_unpaid: true });
      }

      const enrollmentId = await fulfillCheckoutPayment({
        contactId: checkout.contactId,
        productId: checkout.planId,
        provider: PaymentProvider.PAYPAL,
        providerPaymentId: capture.id,
        providerOrderId: resource?.id,
        status: PaymentStatus.APPROVED,
        currency: capture.amount?.currency_code ?? "USD",
        amountMinor,
        rawPayload: payload,
        paidAt: new Date(),
        payerEmail: payer.email,
      });

      await enrichContactFromPayer(checkout.contactId, payer);

      return NextResponse.json({ ok: true, enrollmentId });
    }

    const enrollmentId = await resolveEnrollmentFromReference(reference);
    if (!enrollmentId) {
      return NextResponse.json({ ok: true, enrollment_not_found: true });
    }

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
      payerEmail: payer.email,
    });

    if (approved) {
      const enrollment = await prisma.enrollment.findUnique({
        where: { id: enrollmentId },
        select: { contactId: true },
      });
      if (enrollment) {
        await enrichContactFromPayer(enrollment.contactId, payer);
      }
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[webhook paypal]", e);
    const message = e instanceof Error ? e.message : String(e);
    fireAuditLog({
      action: "WEBHOOK_FAILED",
      entityType: "WebhookEvent",
      entityId: eventId,
      changes: { provider: "PAYPAL", reference, error: message },
    });
    fireNotification({
      eventType: "PAYMENT_WEBHOOK_FAILED",
      title: "Falló el webhook de PayPal",
      body: `No se pudo registrar el cobro ${capture.id}. ${message}`,
      href: "/admin/payments",
      entityType: "WebhookEvent",
      entityId: eventId,
      metadata: { provider: "PAYPAL", reference, captureId: capture.id },
      staff: "ALL",
    });
    return NextResponse.json({ error: "processing_failed" }, { status: 500 });
  }
}
