import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { fireAuditLog } from "@/lib/crm/audit";
import { fireNotification } from "@/lib/notifications/platform/emit";
import { verifyResendWebhook } from "@/lib/webhooks/verify";

export const dynamic = "force-dynamic";

/** The bounce/complaint events that should stop future sends to that address. */
const SUPPRESS_EVENT_TYPES = new Set(["email.bounced", "email.complained"]);

export async function POST(req: NextRequest) {
  // La firma es HMAC sobre el cuerpo crudo — se lee una sola vez y se parsea
  // desde esa misma cadena, igual que el webhook de Meta.
  const rawBody = await req.text();

  if (!verifyResendWebhook(req, rawBody)) {
    fireAuditLog({
      action: "WEBHOOK_REJECTED",
      entityType: "NotificationDelivery",
      entityId: "resend",
      changes: { reason: "invalid_signature" },
    });
    return NextResponse.json({ error: "invalid_signature" }, { status: 401 });
  }

  let payload: { type?: string; data?: { email_id?: string; to?: string[] } };
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const type = payload.type;
  const emailId = payload.data?.email_id;
  if (!type || !SUPPRESS_EVENT_TYPES.has(type) || !emailId) {
    return NextResponse.json({ ok: true });
  }

  const delivery = await prisma.notificationDelivery.findFirst({
    where: { providerId: `resend:${emailId}` },
    include: { contact: { select: { id: true, notifyEmail: true, displayName: true, email: true } } },
  });

  if (!delivery?.contact || !delivery.contact.notifyEmail) {
    return NextResponse.json({ ok: true });
  }
  const contact = delivery.contact;

  await prisma.contact.update({
    where: { id: contact.id },
    data: { notifyEmail: false },
  });

  fireAuditLog({
    action: "AUTO_SUPPRESS_EMAIL",
    entityType: "Contact",
    entityId: contact.id,
    changes: { reason: type, deliveryId: delivery.id },
  });

  fireNotification({
    eventType: "NOTIFICATION_DELIVERY_FAILED",
    title:
      type === "email.complained"
        ? "Un correo fue marcado como spam"
        : "Un correo rebotó",
    body: `${contact.displayName ?? contact.email} — se desactivaron sus notificaciones por correo.`,
    href: `/admin/contacts/${contact.id}`,
    entityType: "Contact",
    entityId: contact.id,
    metadata: { reason: type },
    staff: "ALL",
  });

  return NextResponse.json({ ok: true, suppressed: true });
}
