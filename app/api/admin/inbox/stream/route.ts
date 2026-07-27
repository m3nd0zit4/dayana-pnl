import { NextResponse } from "next/server";
import { resolveAdminStaff } from "@/lib/auth/api-staff";
import { inboxSnapshot } from "@/lib/crm/conversations";
import { isMetaInboxEnabled } from "@/lib/meta/client";
import {
  createFeedStream,
  SSE_HEADERS,
} from "@/lib/notifications/platform/stream";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Stream del contador de la bandeja.
 *
 * Reutiliza `createFeedStream` del feed de notificaciones en vez de montar otro
 * mecanismo: ya resuelve el relevo a los 285 s con `Last-Event-ID`, los pings
 * cuando no cambia nada, y la limpieza del intervalo al abortar — que es lo que
 * evita que una pestaña cerrada deje una instancia de Fluid facturando.
 *
 * Solo viaja `{ unread, latestAt }`; cuando ese par cambia, el cliente decide
 * si recarga la lista.
 */
export const GET = async (req: Request) => {
  if (!isMetaInboxEnabled()) {
    return NextResponse.json({ error: "inbox_disabled" }, { status: 404 });
  }

  const staff = await resolveAdminStaff();
  if (staff instanceof NextResponse) return staff;

  const stream = createFeedStream({
    poll: () => inboxSnapshot(),
    signal: req.signal,
    lastEventId: req.headers.get("last-event-id") ?? undefined,
  });

  return new Response(stream, { headers: SSE_HEADERS });
};
