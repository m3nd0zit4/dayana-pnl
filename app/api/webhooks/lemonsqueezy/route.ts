import { NextRequest, NextResponse } from "next/server";
import { PaymentProvider } from "@prisma/client";
import { fireAuditLog } from "@/lib/crm/audit";
import { registerWebhookEvent, releaseWebhookEvent } from "@/lib/crm/payments";
import {
  failLemonSqueezyCheckout,
  syncLemonSqueezyOrder,
  syncLemonSqueezyRefund,
  syncLemonSqueezySubscriptionEnded,
  syncLemonSqueezySubscriptionPayment,
  type LemonSqueezyWebhookPayload,
} from "@/lib/crm/lemonsqueezy-payments";
import {
  emitPlatformNotification,
  fireNotification,
} from "@/lib/notifications/platform/emit";
import { verifyLemonSqueezyWebhook } from "@/lib/webhooks/verify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const handle = async (
  eventName: string,
  payload: LemonSqueezyWebhookPayload
): Promise<void> => {
  switch (eventName) {
    case "order_created":
      await syncLemonSqueezyOrder(payload);
      return;
    case "order_refunded":
      await syncLemonSqueezyRefund(payload);
      return;
    case "subscription_payment_success":
      await syncLemonSqueezySubscriptionPayment(payload);
      return;
    case "subscription_payment_failed":
      await failLemonSqueezyCheckout(payload);
      return;
    case "subscription_expired":
    case "subscription_cancelled":
      await syncLemonSqueezySubscriptionEnded(payload);
      return;
    default:
      return;
  }
};

export async function POST(req: NextRequest) {
  // Una sola lectura: la firma cubre estos bytes exactos, y re-serializar el
  // JSON parseado los cambia.
  const rawBody = await req.text();

  if (!verifyLemonSqueezyWebhook(req, rawBody)) {
    fireAuditLog({
      action: "WEBHOOK_REJECTED",
      entityType: "WebhookEvent",
      entityId: "lemonsqueezy",
      changes: { reason: "invalid_signature" },
    });
    fireNotification({
      eventType: "PAYMENT_WEBHOOK_FAILED",
      title: "Webhook de Lemon Squeezy rechazado por firma inválida",
      body: "Lemon Squeezy reintentará el aviso; si persiste, revisa LEMONSQUEEZY_WEBHOOK_SECRET.",
      href: "/admin/payments",
      metadata: { provider: "LEMON_SQUEEZY", reason: "invalid_signature" },
      staff: "ALL",
    });
    return NextResponse.json({ error: "invalid_signature" }, { status: 401 });
  }

  let payload: LemonSqueezyWebhookPayload;
  try {
    payload = JSON.parse(rawBody) as LemonSqueezyWebhookPayload;
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const eventName = payload.meta?.event_name;
  const objectId = payload.data?.id;
  if (!eventName || !objectId) {
    return NextResponse.json({ ok: true, skipped: true });
  }

  // Un evento de prueba nunca puede abrir acceso real. LS marca test_mode en
  // cada objeto y sus webhooks de test apuntan a la misma URL.
  if (
    payload.data?.attributes?.test_mode === true &&
    process.env.VERCEL_ENV === "production"
  ) {
    console.warn("[webhook ls] ignoring test_mode event in production", eventName);
    return NextResponse.json({ ok: true, ignored: "test_mode" });
  }

  // LS no manda id de evento: se sintetiza uno estable entre reintentos.
  const eventId = `${eventName}:${objectId}`;

  try {
    const isNew = await registerWebhookEvent(
      PaymentProvider.LEMON_SQUEEZY,
      eventId,
      payload
    );
    if (!isNew) return NextResponse.json({ ok: true, duplicate: true });

    await handle(eventName, payload);
  } catch (e) {
    console.error("[webhook lemonsqueezy]", e);
    const message = e instanceof Error ? e.message : String(e);
    fireAuditLog({
      action: "WEBHOOK_FAILED",
      entityType: "WebhookEvent",
      entityId: eventId,
      changes: { provider: "LEMON_SQUEEZY", event: eventName, error: message },
    });
    await emitPlatformNotification({
      eventType: "PAYMENT_WEBHOOK_FAILED",
      title: "Falló el webhook de Lemon Squeezy",
      body: `No se pudo procesar ${eventName} (${objectId}). ${message}`,
      href: "/admin/payments",
      entityType: "WebhookEvent",
      entityId: eventId,
      metadata: { provider: "LEMON_SQUEEZY", event: eventName },
      staff: "ALL",
    }).catch(() => undefined);

    // Se libera la reserva de idempotencia: si no, el reintento de LS se
    // cortaría como duplicado y el pago no se registraría nunca. Reejecutar es
    // seguro porque el fulfilment es idempotente por provider payment id.
    await releaseWebhookEvent(PaymentProvider.LEMON_SQUEEZY, eventId);

    return NextResponse.json({ error: "handler_failed" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
