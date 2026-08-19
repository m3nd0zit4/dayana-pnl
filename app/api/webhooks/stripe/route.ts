import { NextRequest, NextResponse } from "next/server";
import type Stripe from "stripe";
import { PaymentProvider } from "@prisma/client";
import { fireAuditLog } from "@/lib/crm/audit";
import { registerWebhookEvent, releaseWebhookEvent } from "@/lib/crm/payments";
import {
  failStripeCheckoutSession,
  syncStripeCheckoutSession,
  syncStripeInvoicePaid,
  syncStripeSubscriptionDeleted,
} from "@/lib/crm/stripe-payments";
import {
  emitPlatformNotification,
  fireNotification,
} from "@/lib/notifications/platform/emit";
import { verifyAndParseStripeWebhook } from "@/lib/webhooks/verify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const handle = async (event: Stripe.Event): Promise<void> => {
  switch (event.type) {
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded": {
      const session = event.data.object as Stripe.Checkout.Session;
      // Re-read the session from the API rather than trusting the event body:
      // the same helper backs the /pago/exito reconciliation, and a replayed
      // event can carry a stale `payment_status`.
      await syncStripeCheckoutSession(session.id);
      return;
    }
    case "checkout.session.async_payment_failed": {
      await failStripeCheckoutSession(
        event.data.object as Stripe.Checkout.Session
      );
      return;
    }
    case "invoice.paid": {
      await syncStripeInvoicePaid(event.data.object as Stripe.Invoice);
      return;
    }
    case "customer.subscription.deleted": {
      await syncStripeSubscriptionDeleted(
        event.data.object as Stripe.Subscription
      );
      return;
    }
    default:
      return;
  }
};

export async function POST(req: NextRequest) {
  // Read once: the signature covers these exact bytes, so re-serializing the
  // parsed JSON would break verification.
  const rawBody = await req.text();
  const event = await verifyAndParseStripeWebhook(req, rawBody);

  if (!event) {
    fireAuditLog({
      action: "WEBHOOK_REJECTED",
      entityType: "WebhookEvent",
      entityId: "stripe",
      changes: { reason: "invalid_signature" },
    });
    fireNotification({
      eventType: "PAYMENT_WEBHOOK_FAILED",
      title: "Webhook de Stripe rechazado por firma inválida",
      body: "Stripe reintentará el aviso; si persiste, revisa STRIPE_WEBHOOK_SECRET.",
      href: "/admin/payments",
      metadata: { provider: "STRIPE", reason: "invalid_signature" },
      staff: "ALL",
    });
    return NextResponse.json({ error: "invalid_signature" }, { status: 401 });
  }

  try {
    const isNew = await registerWebhookEvent(
      PaymentProvider.STRIPE,
      event.id,
      event
    );
    // Stripe retries on any non-2xx and replays from the Dashboard; a duplicate
    // must be a no-op, not a second Payment row and a second membership month.
    if (!isNew) return NextResponse.json({ ok: true, duplicate: true });

    await handle(event);
  } catch (e) {
    console.error("[webhook stripe]", e);
    const message = e instanceof Error ? e.message : String(e);
    fireAuditLog({
      action: "WEBHOOK_FAILED",
      entityType: "WebhookEvent",
      entityId: event.id,
      changes: { provider: "STRIPE", type: event.type, error: message },
    });
    await emitPlatformNotification({
      eventType: "PAYMENT_WEBHOOK_FAILED",
      title: "Falló el webhook de Stripe",
      body: `No se pudo procesar ${event.type} (${event.id}). ${message}`,
      href: "/admin/payments",
      entityType: "WebhookEvent",
      entityId: event.id,
      metadata: { provider: "STRIPE", type: event.type },
      staff: "ALL",
    }).catch(() => undefined);

    // Release the idempotency claim, otherwise Stripe's retry would
    // short-circuit as a duplicate and the payment would never be recorded.
    // Re-running is safe: fulfilment is idempotent per provider payment id.
    await releaseWebhookEvent(PaymentProvider.STRIPE, event.id);

    return NextResponse.json({ error: "handler_failed" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
