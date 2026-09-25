import { NextResponse } from "next/server";
import { z } from "zod";

import { apiError, readJson, withStaff } from "@/lib/api/handler";
import { prisma } from "@/lib/db";
import { confirmAppointmentPerson, syncAppointments } from "@/lib/crm/whatsapp-agent/appointments";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Próximas citas (14 días) y las que falta saber quién es. */
export const GET = withStaff("read", async () => {
  const now = new Date();
  const rows = await prisma.calendarAppointment.findMany({
    where: { status: "active", startsAt: { gte: new Date(now.getTime() - 2 * 3600_000), lte: new Date(now.getTime() + 14 * 24 * 3600_000) } },
    orderBy: { startsAt: "asc" },
    take: 200,
  });
  return NextResponse.json({
    items: rows.map((a) => ({
      id: a.id,
      startsAt: a.startsAt.toISOString(),
      title: a.title,
      name: a.name,
      phone: a.phone,
      sessionsLabel: a.sessionsLabel,
      conversationId: a.conversationId,
      contactId: a.contactId,
      matchState: a.matchState,
      candidates: a.candidates,
      confirmedAt: a.confirmedAt?.toISOString() ?? null,
      reminderSentAt: a.reminderSentAt?.toISOString() ?? null,
      reminderError: a.reminderError,
    })),
  });
});

const schema = z.discriminatedUnion("action", [
  /** Leer el calendario ahora (sin esperar al reloj). */
  z.object({ action: z.literal("sync") }),
  /** Dayana eligió quién es o escribió el número. */
  z.object({ action: z.literal("assign"), appointmentId: z.string(), phone: z.string().min(8).max(20) }),
]);

export const POST = withStaff("write", async ({ req }) => {
  const parsed = schema.safeParse(await readJson(req));
  if (!parsed.success) return apiError("invalid_body", 400);
  try {
    if (parsed.data.action === "sync") return NextResponse.json(await syncAppointments());
    const digits = parsed.data.phone.replace(/\D/g, "");
    if (digits.length < 10) return apiError("Escribe el número con código de país (ej. +57 300…).", 400);
    await confirmAppointmentPerson({ appointmentId: parsed.data.appointmentId, phoneE164: `+${digits}` });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return apiError(e instanceof Error ? e.message : "error", 400);
  }
});
