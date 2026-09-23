import { NextRequest, NextResponse } from "next/server";

import { cancelAppointment, getAppointmentByCancelToken } from "@/lib/crm/booking";
import { fireNotification } from "@/lib/notifications/platform/emit";
import { clientIp, rateLimitDistributed } from "@/lib/api/rate-limit-distributed";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Cancelar con el token del correo. El token (128 bits) es la autorización:
 * no hay sesión que pedirle a quien solo vino a avisar que no puede.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const ip = clientIp(req);
  const rl = await rateLimitDistributed(`agenda-cancel:${ip}`, 20, 60_000);
  if (!rl.ok) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  const { token } = await params;
  const appointment = await getAppointmentByCancelToken(token);
  if (!appointment) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const wasBooked = appointment.status === "BOOKED";
  await cancelAppointment(appointment.id, "persona");

  if (wasBooked) {
    fireNotification({
      eventType: "LEAD_CREATED",
      title: `Cita cancelada: ${appointment.name}`,
      body: appointment.startsAt.toISOString(),
      href: "/admin/agenda",
      entityType: "Appointment",
      entityId: appointment.id,
      staff: "ALL",
    });
  }

  return NextResponse.json({ ok: true });
}
