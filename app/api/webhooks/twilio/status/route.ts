import { NotificationDeliveryStatus } from "@prisma/client";
import { NextResponse, type NextRequest } from "next/server";
import { fireAuditLog } from "@/lib/crm/audit";
import { prisma } from "@/lib/db";
import {
  describeTwilioError,
  isPermanentSmsError,
} from "@/lib/notifications/twilio-errors";
import { fireNotification } from "@/lib/notifications/platform/emit";
import { verifyTwilioWebhook } from "@/lib/webhooks/verify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * StatusCallback de Twilio.
 *
 * Sin esto un 2xx del API de mensajes se registra como SENT y nadie confirma
 * nunca que el mensaje llegó al teléfono: un SMS que muere en el operador se
 * cobra por segmento y en /admin/ajustes/registro se lee como un éxito.
 *
 * Se separa a propósito del precedente de Resend, que NO toca el estado de la
 * fila: un rebote de correo es un hecho sobre la dirección después de una
 * entrega real, mientras que `failed`/`undelivered` de Twilio significan que
 * este mensaje no llegó. Dejarlo en SENT sería afirmar algo falso.
 */

/** Estados intermedios: no se toca la base de datos. */
const NON_TERMINAL = new Set([
  "queued",
  "accepted",
  "scheduled",
  "sending",
  "sent",
  "receiving",
  "received",
]);

const FAILED_STATUSES = new Set(["failed", "undelivered"]);

export async function POST(req: NextRequest) {
  // La firma cubre el cuerpo crudo: se lee una sola vez y se parsea de ahí.
  const rawBody = await req.text();

  if (!verifyTwilioWebhook(req, rawBody)) {
    fireAuditLog({
      action: "WEBHOOK_REJECTED",
      entityType: "NotificationDelivery",
      entityId: "twilio-status",
      changes: { reason: "invalid_signature" },
    });
    return NextResponse.json({ error: "invalid_signature" }, { status: 401 });
  }

  const params = new URLSearchParams(rawBody);
  const messageSid = params.get("MessageSid") ?? params.get("SmsSid");
  const status = params.get("MessageStatus")?.toLowerCase() ?? "";

  if (!messageSid || !status) return NextResponse.json({ ok: true });

  // Una campaña de 100k mensajes genera ~300k callbacks intermedios. Salir aquí
  // antes de tocar la base es lo que hace que esto sea barato.
  if (NON_TERMINAL.has(status)) return NextResponse.json({ ok: true });

  const providerId = `twilio:${messageSid}`;

  if (status === "delivered") {
    // updateMany y no update: provider_id no es único y la fila pudo haber sido
    // podada por la retención. El guard sobre deliveredAt hace el callback
    // idempotente frente a los reintentos de Twilio.
    await prisma.notificationDelivery.updateMany({
      where: { providerId, deliveredAt: null },
      data: { deliveredAt: new Date() },
    });
    return NextResponse.json({ ok: true });
  }

  if (!FAILED_STATUSES.has(status)) return NextResponse.json({ ok: true });

  const rawCode = params.get("ErrorCode");
  const errorCode = rawCode && /^\d+$/.test(rawCode) ? Number(rawCode) : null;
  const errorMessage = describeTwilioError(errorCode);

  const delivery = await prisma.notificationDelivery.findFirst({
    where: { providerId },
    include: {
      contact: {
        select: { id: true, notifySms: true, displayName: true, phoneE164: true },
      },
    },
  });

  // Puede no existir: la fila fue podada, o el callback llegó antes de que
  // dispatchAndRecord la escribiera. En ambos casos no hay nada que corregir.
  if (!delivery) return NextResponse.json({ ok: true });

  // Un `delivered` previo gana sobre un `failed` que llega tarde y desordenado:
  // Twilio no des-entrega un mensaje.
  const updated = await prisma.notificationDelivery.updateMany({
    where: {
      id: delivery.id,
      deliveredAt: null,
      status: { not: NotificationDeliveryStatus.FAILED },
    },
    data: { status: NotificationDeliveryStatus.FAILED, errorMessage },
  });

  if (updated.count === 0) return NextResponse.json({ ok: true });

  // No se descuenta NotificationCampaign.sentCount: es una foto del momento del
  // envío, la campaña puede estar ya COMPLETED y dos escritores sobre los
  // mismos contadores es una carrera sin beneficio. La verdad son las filas.
  fireNotification({
    eventType: "NOTIFICATION_DELIVERY_FAILED",
    title: "No se pudo entregar un SMS",
    body: [delivery.recipient, errorMessage].filter(Boolean).join(" · "),
    href: delivery.contact
      ? `/admin/contacts/${delivery.contact.id}`
      : "/admin/ajustes/registro",
    entityType: "NotificationDelivery",
    entityId: delivery.id,
    metadata: { channel: delivery.channel, errorCode },
    staff: "ALL",
  });

  const contact = delivery.contact;
  if (!contact || !contact.notifySms || !isPermanentSmsError(errorCode)) {
    return NextResponse.json({ ok: true });
  }

  await prisma.contact.update({
    where: { id: contact.id },
    data: { notifySms: false },
  });

  fireAuditLog({
    action: "AUTO_SUPPRESS_SMS",
    entityType: "Contact",
    entityId: contact.id,
    changes: { reason: errorMessage, deliveryId: delivery.id },
  });

  fireNotification({
    eventType: "NOTIFICATION_DELIVERY_FAILED",
    title: "Se desactivaron los SMS de un contacto",
    body: `${contact.displayName ?? contact.phoneE164} — ${errorMessage}`,
    href: `/admin/contacts/${contact.id}`,
    entityType: "Contact",
    entityId: contact.id,
    metadata: { errorCode },
    staff: "ALL",
  });

  return NextResponse.json({ ok: true, suppressed: true });
}
