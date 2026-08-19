import { NextResponse } from "next/server";
import { SubscriptionStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getMemberSession } from "@/lib/auth/member-session";
import { cancelPayPalSubscription } from "@/lib/paypal/subscriptions";
import { fireNotification } from "@/lib/notifications/platform/emit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Cancela la suscripción de la miembro autenticada.
 *
 * **Cancelar detiene la renovación, no el acceso ya pagado.** `paidUntil` no se
 * toca: ese mes está cobrado y `getMembershipLockState` cerrará el portal solo
 * cuando llegue la fecha. Cortar antes sería quedarse con dinero por un
 * servicio no prestado.
 *
 * Se cancela SÓLO sobre la suscripción del contacto de la sesión: el id nunca
 * viene del cliente, se busca a partir de quién está autenticado.
 */
export async function POST() {
  const session = await getMemberSession();
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const enrollment = await prisma.enrollment.findFirst({
    where: {
      contactId: session.contact.id,
      paypalSubscriptionId: { not: null },
      subscriptionStatus: SubscriptionStatus.ACTIVE,
    },
    orderBy: { createdAt: "desc" },
    select: { id: true, paypalSubscriptionId: true, paidUntil: true },
  });

  if (!enrollment?.paypalSubscriptionId) {
    return NextResponse.json({ error: "no_active_subscription" }, { status: 404 });
  }

  try {
    await cancelPayPalSubscription(
      enrollment.paypalSubscriptionId,
      "Cancelada por la miembro desde el portal"
    );
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("[subscription cancel]", message);
    return NextResponse.json({ error: "cancel_failed" }, { status: 502 });
  }

  /**
   * Se marca aquí además de esperar a `BILLING.SUBSCRIPTION.CANCELLED`: el
   * webhook puede tardar, y la miembro acaba de pulsar el botón — tiene que ver
   * el cambio de inmediato. Cuando llegue el webhook escribirá lo mismo.
   */
  await prisma.enrollment.update({
    where: { id: enrollment.id },
    data: { subscriptionStatus: SubscriptionStatus.CANCELLED },
  });

  fireNotification({
    eventType: "SUBSCRIPTION_CANCELLED",
    title: "Una miembro canceló su suscripción",
    body: enrollment.paidUntil
      ? `Mantiene acceso hasta el ${enrollment.paidUntil.toLocaleDateString("es-CO")}.`
      : "No se renovará.",
    href: `/admin/enrollments/${enrollment.id}`,
    entityType: "Enrollment",
    entityId: enrollment.id,
    staff: "ALL",
  });

  return NextResponse.json({
    ok: true,
    paidUntil: enrollment.paidUntil?.toISOString() ?? null,
  });
}
