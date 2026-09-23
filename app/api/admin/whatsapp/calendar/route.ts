import { NextResponse } from "next/server";

import { resolveGoogleAccount } from "@/agent/lib/google";
import { apiError, withStaff } from "@/lib/api/handler";
import { prisma } from "@/lib/db";
import { getWhatsAppAiConfig } from "@/lib/crm/whatsapp-ai-config";
import { isAvailabilityBlock } from "@/lib/crm/whatsapp-agent/calendar";
import { listEvents } from "@/lib/google/calendar";

export const dynamic = "force-dynamic";

/**
 * La agenda real: el Google Calendar de Dayana, próximos días. El CRM no
 * guarda horarios propios; lo que se ve aquí es lo mismo que ve ella en su
 * calendario, marcando cuáles agendó la IA y cuáles son bloques «Disponible».
 */
export const GET = withStaff("read", async ({ req }) => {
  const days = Math.min(31, Math.max(1, Number(new URL(req.url).searchParams.get("days")) || 14));
  const config = await getWhatsAppAiConfig();
  const from = new Date();
  const to = new Date(from.getTime() + days * 24 * 3600_000);
  try {
    const { account, token } = await resolveGoogleAccount(
      "CALENDAR",
      config.booking.accountId || undefined
    );
    const [events, aiBookings] = await Promise.all([
      listEvents(token, { timeMin: from.toISOString(), timeMax: to.toISOString(), maxResults: 250 }),
      prisma.whatsAppBooking.findMany({
        where: { startsAt: { gte: from, lt: to } },
        select: { calendarEventId: true, conversationId: true },
      }),
    ]);
    const byEvent = new Map(aiBookings.map((b) => [b.calendarEventId, b.conversationId]));
    return NextResponse.json({
      account: account.email ?? account.displayName,
      events: events
        .filter((e) => e.status !== "cancelled")
        .map((e) => ({
          id: e.id,
          summary: e.summary ?? "(sin título)",
          start: e.start?.dateTime ?? e.start?.date ?? null,
          end: e.end?.dateTime ?? e.end?.date ?? null,
          allDay: Boolean(e.start?.date && !e.start?.dateTime),
          availability: isAvailabilityBlock(e.summary),
          free: e.transparency === "transparent",
          meetUrl: e.hangoutLink ?? null,
          link: e.htmlLink ?? null,
          aiConversationId: byEvent.get(e.id) ?? null,
        })),
    });
  } catch (e) {
    return apiError(e instanceof Error ? e.message : "calendar_failed", 400);
  }
});
