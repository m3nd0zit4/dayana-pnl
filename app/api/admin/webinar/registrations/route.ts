import { NextRequest, NextResponse } from "next/server";
import { resolveAdminStaff } from "@/lib/auth/api-staff";
import { ensureFreeWebinar } from "@/lib/crm/free-webinar";
import {
  listWebinarRegistrations,
  webinarRegistrationStats,
} from "@/lib/crm/webinar-registrations";

export const dynamic = "force-dynamic";

const MAX_TAKE = 100;

/**
 * Lista paginada de registradas.
 *
 * Existe porque el panel se renderiza con las 50 más recientes: sin búsqueda
 * ni paginación no había forma de llegar a nadie más allá de esa fila, y el
 * reenvío individual sería inalcanzable justo para quien más lo necesita.
 *
 * `webinarId` permite servir también el historial de una edición archivada
 * con el mismo endpoint.
 */
export async function GET(req: NextRequest) {
  const staff = await resolveAdminStaff();
  if (staff instanceof NextResponse) return staff;

  const url = new URL(req.url);
  const webinarId =
    url.searchParams.get("webinarId")?.trim() ||
    (await ensureFreeWebinar()).id;

  const take = Math.min(
    Math.max(Number(url.searchParams.get("take") ?? 50) || 50, 1),
    MAX_TAKE
  );
  const skip = Math.max(Number(url.searchParams.get("skip") ?? 0) || 0, 0);
  const q = url.searchParams.get("q") ?? undefined;
  const failedOnly = url.searchParams.get("failedOnly") === "true";

  const [rows, stats] = await Promise.all([
    listWebinarRegistrations(webinarId, { take, skip, q, failedOnly }),
    skip === 0
      ? webinarRegistrationStats(webinarId)
      : Promise.resolve(null),
  ]);

  return NextResponse.json({
    registrations: rows.map((r) => ({
      id: r.id,
      contactId: r.contact.id,
      name: [r.contact.firstName, r.contact.lastName].filter(Boolean).join(" "),
      email: r.contact.email,
      phoneE164: r.contact.phoneE164,
      notifyEmail: r.contact.notifyEmail,
      createdAtIso: r.createdAt.toISOString(),
      linkEmailSentAt: r.linkEmailSentAt?.toISOString() ?? null,
      reminder24hSentAt: r.reminder24hSentAt?.toISOString() ?? null,
      reminder1hSentAt: r.reminder1hSentAt?.toISOString() ?? null,
      lastSendError: r.lastSendError,
      lastSendErrorAt: r.lastSendErrorAt?.toISOString() ?? null,
    })),
    stats,
    hasMore: rows.length === take,
  });
}
