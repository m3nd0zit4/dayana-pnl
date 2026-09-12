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
  syncAuthorizedPayment,
  syncPreapproval,
} from "@/lib/crm/mercadopago-subscriptions";
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
    /**
     * El aviso lleva el id del recurso y el `x-request-id`.
     *
     * Sin ellos el mensaje era «revisa MERCADOPAGO_WEBHOOK_SECRET» y nada
     * más, y eso no basta: Mercado Pago entrega el mismo pago por DOS vías —el
     * `notification_url` de cada preferencia y el webhook del panel, que es
     * configuración aparte— y cada una va firmada por la aplicación que la
     * originó. Si sólo una de las dos firma con el secreto que tenemos, la
     * mitad de las entregas se rechaza y el aviso no dice cuál.
     *
     * Con estos dos datos se cruza contra la lista de entregas del panel de
     * MP y se ve en el acto qué remitente falla.
     */
    const rid = req.headers.get("x-request-id");
    const resourceId =
      req.headers.get("x-data-id") ??
      (() => {
        try {
          const j = JSON.parse(rawBody) as { data?: { id?: string } };
          return j.data?.id != null ? String(j.data.id) : null;
        } catch {
          return null;
        }
      })();

    fireAuditLog({
      action: "WEBHOOK_REJECTED",
      entityType: "WebhookEvent",
      entityId: "mercadopago",
      changes: { reason: "invalid_signature", resourceId, requestId: rid },
    });
    fireNotification({
      eventType: "PAYMENT_WEBHOOK_FAILED",
      title: "Webhook de Mercado Pago rechazado por firma inválida",
      body:
        `Recurso ${resourceId ?? "desconocido"} · petición ${rid ?? "sin id"}. ` +
        "Búscalo en el panel de MP (Tus integraciones → Webhooks → Entregas): " +
        "si esa entrega aparece ahí como correcta, el aviso rechazado viene de " +
        "OTRA integración y su secreto no es el de MERCADOPAGO_WEBHOOK_SECRET.",
      href: "/admin/payments",
      metadata: {
        provider: "MERCADO_PAGO",
        reason: "invalid_signature",
        resourceId,
        requestId: rid,
      },
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

      /**
       * Suscripciones. MP usa `type` para distinguir:
       *
       * - `subscription_preapproval` — alta y cambios de estado.
       * - `subscription_authorized_payment` — cada cobro, el primero incluido.
       *
       * No pasan por `syncMercadoPagoPayment`: ese lee `/v1/payments/<id>`, y
       * estos ids son de otros recursos. Mandarlos ahí devolvía 404 y el cobro
       * se perdía en silencio.
       */
      if (payload.type === "subscription_preapproval") {
        await syncPreapproval(String(paymentId));
        return;
      }
      if (payload.type === "subscription_authorized_payment") {
        await syncAuthorizedPayment(String(paymentId));
        return;
      }

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
