import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { PaymentProvider } from "@prisma/client";
import { fireAuditLog } from "@/lib/crm/audit";
import {
  registerWebhookEvent,
  releaseWebhookEvent,
} from "@/lib/crm/payments";
import { syncMercadoPagoPayment } from "@/lib/crm/mercadopago-payments";
import {
  emitPlatformNotification,
  fireNotification,
} from "@/lib/notifications/platform/emit";
import { verifyMercadoPagoWebhook } from "@/lib/webhooks/verify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  if (!verifyMercadoPagoWebhook(req, rawBody)) {
    fireAuditLog({
      action: "WEBHOOK_REJECTED",
      entityType: "WebhookEvent",
      entityId: "mercadopago",
      changes: { reason: "invalid_signature" },
    });
    fireNotification({
      eventType: "PAYMENT_WEBHOOK_FAILED",
      title: "Webhook de Mercado Pago rechazado por firma inválida",
      body: "Mercado Pago reintentará el aviso; si persiste, revisa MERCADOPAGO_WEBHOOK_SECRET.",
      href: "/admin/payments",
      metadata: { provider: "MERCADO_PAGO", reason: "invalid_signature" },
      staff: "ALL",
    });
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
      const message = e instanceof Error ? e.message : String(e);

      // La respuesta 200 ya salió, así que MP no reintenta ESTE aviso; pero sí
      // manda más por el mismo pago. Soltar la marca deja que el siguiente
      // haga el trabajo en lugar de descartarse como duplicado.
      await releaseWebhookEvent(PaymentProvider.MERCADO_PAGO, eventId);
      fireAuditLog({
        action: "WEBHOOK_FAILED",
        entityType: "WebhookEvent",
        entityId: eventId,
        changes: { provider: "MERCADO_PAGO", paymentId, error: message },
      });
      // Ya estamos dentro de `after()`: se espera el emit para que la
      // invocación no muera antes de escribirlo.
      await emitPlatformNotification({
        eventType: "PAYMENT_WEBHOOK_FAILED",
        title: "Falló el webhook de Mercado Pago",
        body: `No se pudo sincronizar el pago ${paymentId}. ${message}`,
        href: "/admin/payments",
        entityType: "WebhookEvent",
        entityId: eventId,
        metadata: { provider: "MERCADO_PAGO", paymentId },
        staff: "ALL",
      }).catch(() => undefined);
    }
  });

  return NextResponse.json({ ok: true });
}
