import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { PaymentProvider } from "@prisma/client";
import { fireAuditLog } from "@/lib/crm/audit";
import { claimDailyAlert } from "@/lib/crm/daily-alert-flag";
import { prisma } from "@/lib/db";
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

const UNSIGNED_ALERT_SETTING = "mp.webhook.unsigned_alert_day";
/** Si en este tiempo entró algún webhook FIRMADO, lo sin firma es el IPN duplicado. */
const SIGNED_LOOKBACK_MS = 6 * 60 * 60 * 1000;
/**
 * Margen para que el firmado del mismo pago se registre (`after()`, un par de
 * segundos) antes de mirar. 20 s y no más: cada entrega sin firma mantiene la
 * función viva todo este tiempo y los IPN llegan en ráfaga.
 */
const unsignedGraceMs = (): number =>
  Number(process.env.MP_UNSIGNED_GRACE_MS ?? 20_000);

const runAfter = (fn: () => Promise<void>): void => {
  try {
    after(fn);
  } catch {
    // Fuera de una petición (scripts, pruebas): se lanza sin esperar.
    void fn();
  }
};

/**
 * Una entrega sin firma casi siempre es el IPN legado que Mercado Pago manda
 * junto al webhook firmado del mismo pago: se rechaza y no hace falta avisar a
 * nadie. Pero si MP dejara de firmar —o el panel apuntara mal— sería la ÚNICA
 * señal de que los pagos pendientes (PSE, efectivo) ya no se registran. Por eso
 * se avisa cuando, pasado un margen, en las últimas 6 h no entró NINGÚN
 * webhook firmado; como mucho una vez al día para no volver al ruido de
 * 13 alertas «recurso desconocido».
 */
const alertIfNoSignedWebhookRecently = async (): Promise<void> => {
  try {
    await new Promise((r) => setTimeout(r, unsignedGraceMs()));
    const signed = await prisma.webhookEvent.count({
      where: {
        provider: PaymentProvider.MERCADO_PAGO,
        processedAt: { gte: new Date(Date.now() - SIGNED_LOOKBACK_MS) },
      },
    });
    if (signed > 0) return;
    // Atómico: los IPN llegan en ráfaga y cada uno lanza esta comprobación.
    if (!(await claimDailyAlert(UNSIGNED_ALERT_SETTING))) return;
    fireNotification({
      eventType: "PAYMENT_WEBHOOK_FAILED",
      title: "Mercado Pago envía avisos sin firma y ninguno firmado",
      body:
        "Llegaron notificaciones sin firma y en las últimas 6 horas no entró ningún webhook firmado. " +
        "Si hubo pagos, revisa en el panel de Mercado Pago (Tus integraciones → Webhooks) que el " +
        "webhook esté activo y con el secreto correcto: sin él los pagos pendientes no se registran solos.",
      href: "/admin/payments",
      metadata: { provider: "MERCADO_PAGO", reason: "no_signed_webhook" },
      staff: "ALL",
    });
  } catch (e) {
    console.error("[webhook mercadopago] aviso de entregas sin firma", e);
  }
};

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
    /**
     * ¿Venía firmado? Es lo que separa los dos casos que se mezclaban:
     *
     * - **Con `x-signature` pero que no cuadra**: un remitente que SÍ firma
     *   con otro secreto. Eso es configuración y merece el aviso.
     * - **Sin `x-signature`**: la notificación legada (IPN) que Mercado Pago
     *   manda además del webhook, con otro formato (`topic` + `resource` en
     *   lugar de `data.id`) y sin firma. Nunca la va a llevar, el pago ya llega
     *   por el webhook firmado, y avisar al equipo cada vez dejó 13 alertas
     *   «recurso desconocido» desde el 19-oct. Se rechaza igual (401: es lo que
     *   comprueba el chequeo rápido del CLAUDE.md) y queda en la auditoría,
     *   pero sin campana.
     */
    const hasSignature = Boolean(req.headers.get("x-signature"));
    let topic: string | null = null;
    const resourceId =
      req.headers.get("x-data-id") ??
      req.nextUrl.searchParams.get("data.id") ??
      req.nextUrl.searchParams.get("id") ??
      (() => {
        try {
          const j = JSON.parse(rawBody) as {
            data?: { id?: string };
            resource?: string;
            topic?: string;
          };
          topic = j.topic ?? null;
          if (j.data?.id != null) return String(j.data.id);
          // IPN legado: `resource` es una URL que acaba en el id.
          const tail = j.resource?.split("/").pop();
          return tail || null;
        } catch {
          return null;
        }
      })();
    topic ??= req.nextUrl.searchParams.get("topic");

    fireAuditLog({
      action: "WEBHOOK_REJECTED",
      entityType: "WebhookEvent",
      entityId: "mercadopago",
      changes: {
        reason: hasSignature ? "invalid_signature" : "unsigned_delivery",
        resourceId,
        requestId: rid,
        topic,
      },
    });
    if (!hasSignature) {
      runAfter(alertIfNoSignedWebhookRecently);
      return NextResponse.json({ error: "invalid_signature" }, { status: 401 });
    }
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
