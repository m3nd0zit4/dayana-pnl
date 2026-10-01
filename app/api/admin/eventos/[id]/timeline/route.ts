import { NextResponse } from "next/server";
import { apiError, withStaff } from "@/lib/api/handler";
import { getFreeEventTimeline } from "@/lib/crm/free-events";
import { getFreeEventById } from "@/lib/crm/free-webinar";
import { getOperationalTimezone } from "@/lib/crm/operational-timezone";

export const dynamic = "force-dynamic";

/** La historia del evento: actividad, envíos, inscripciones por día y sellos. */
export const GET = withStaff<{ id: string }>("read", async ({ params }) => {
  const event = await getFreeEventById(params.id);
  if (!event) return apiError("not_found", 404);
  const tz = await getOperationalTimezone();
  return NextResponse.json({ timeline: await getFreeEventTimeline(event.id, tz) });
});
