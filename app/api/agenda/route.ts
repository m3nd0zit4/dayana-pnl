import { NextRequest, NextResponse, after } from "next/server";

import {
  BookingError,
  createBooking,
  getBookingConfig,
  listAvailableSlots,
} from "@/lib/crm/booking";
import { getOperationalTimezone } from "@/lib/crm/operational-timezone";
import { sendEmail } from "@/lib/notifications/channels/email";
import {
  appointmentEmailHtml,
  appointmentEmailSubject,
  appointmentEmailText,
} from "@/lib/notifications/templates/appointment";
import { fireNotification } from "@/lib/notifications/platform/emit";
import { siteUrl } from "@/lib/notifications/config";
import { clientIp, rateLimitDistributed } from "@/lib/api/rate-limit-distributed";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** Los huecos libres, recalculados en cada carga contra el calendario real. */
export async function GET() {
  const config = await getBookingConfig();
  if (!config.isActive) {
    return NextResponse.json({ error: "closed" }, { status: 404 });
  }
  const timezone = await getOperationalTimezone();
  const days = await listAvailableSlots(config, timezone);
  return NextResponse.json({
    title: config.title,
    description: config.description,
    durationMinutes: config.durationMinutes,
    timezone,
    days,
  });
}

export async function POST(req: NextRequest) {
  const ip = clientIp(req);
  const rl = await rateLimitDistributed(`agenda:${ip}`, 10, 60_000);
  if (!rl.ok) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  const body = (await req.json().catch(() => null)) as {
    startIso?: string;
    name?: string;
    email?: string;
    phone?: string;
    note?: string;
    source?: string;
  } | null;

  const name = body?.name?.trim() ?? "";
  const email = body?.email?.trim().toLowerCase() ?? "";

  if (name.length < 2) {
    return NextResponse.json({ error: "missing_name" }, { status: 400 });
  }
  if (!EMAIL_RE.test(email) || email.length > 200) {
    return NextResponse.json({ error: "invalid_email" }, { status: 400 });
  }
  if (!body?.startIso) {
    return NextResponse.json({ error: "invalid_slot" }, { status: 400 });
  }

  try {
    const appointment = await createBooking({
      startIso: body.startIso,
      name,
      email,
      phone: body.phone ?? null,
      note: body.note ?? null,
      source: body.source ?? null,
    });

    const config = await getBookingConfig();
    const cancelUrl = `${siteUrl()}/agenda/cancelar/${appointment.cancelToken}`;

    after(async () => {
      try {
        const input = {
          firstName: name,
          title: config.title,
          startsAt: appointment.startsAt,
          timezone: appointment.timezone,
          meetUrl: appointment.meetUrl,
          cancelUrl,
        };
        await sendEmail({
          to: email,
          subject: appointmentEmailSubject(input),
          html: appointmentEmailHtml(input),
          text: appointmentEmailText(input),
        });
      } catch (e) {
        console.error("[agenda] no se pudo enviar la confirmación", e);
      }
    });

    fireNotification({
      eventType: "LEAD_CREATED",
      title: `Cita nueva: ${name}`,
      body: `${config.title} · ${appointment.startsAt.toISOString()}`,
      href: "/admin/agenda",
      entityType: "Appointment",
      entityId: appointment.id,
      staff: "ALL",
    });

    return NextResponse.json({
      startsAt: appointment.startsAt.toISOString(),
      timezone: appointment.timezone,
      meetUrl: appointment.meetUrl,
      cancelUrl,
    });
  } catch (e) {
    if (e instanceof BookingError) {
      return NextResponse.json({ error: e.code }, { status: 409 });
    }
    console.error("[agenda] no se pudo reservar", e);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
