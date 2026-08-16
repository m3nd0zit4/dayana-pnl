import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireBroadcastStaff, requireWriteStaff } from "@/lib/auth/api-staff";
import { fireAuditLog } from "@/lib/crm/audit";
import { ensureFreeWebinar, FREE_WEBINAR_SLUG } from "@/lib/crm/free-webinar";
import {
  drainWebinarMail,
  resendWebinarMailToAll,
  resendWebinarMailToOne,
} from "@/lib/crm/webinar-mailer";
import { rateLimitDistributed } from "@/lib/api/rate-limit-distributed";

export const dynamic = "force-dynamic";

/**
 * Reenvío manual de los correos del webinar.
 *
 * Los barridos ya reintentan solos —un fallo suelta el sello y el siguiente
 * cron lo recoge— así que esto es para forzarlo: alguien borró el correo, las
 * notificaciones estuvieron apagadas, o el contenido salió mal.
 *
 * Los tres alcances tienen permisos y límites distintos a propósito: `all`
 * puede ser un envío de 10k correos y es, de largo, el más caro de deshacer.
 */
const bodySchema = z.object({
  scope: z.enum(["one", "pending", "all"]),
  pass: z.enum(["link", "24h", "1h"]),
  registrationId: z.string().min(1).optional(),
});

export async function POST(req: NextRequest) {
  const raw = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }
  const { scope, pass, registrationId } = parsed.data;

  // `all` es OWNER: es la convención de la casa para envíos masivos, la misma
  // que usan /admin/messages y la herramienta de correo del agente.
  const staff =
    scope === "all" ? await requireBroadcastStaff() : await requireWriteStaff();
  if (staff instanceof NextResponse) return staff;

  const limits = {
    one: { max: 30, windowMs: 60_000 },
    // Un barrido de pendientes es idempotente: solo escribe a quien todavia
    // no lo tiene. Con 5/hora, durante un evento en vivo —con gente
    // registrandose sobre la marcha— el boton se bloquea justo cuando mas se
    // usa, y el mensaje parece que la aplicacion esta rota.
    pending: { max: 20, windowMs: 60 * 60_000 },
    all: { max: 2, windowMs: 24 * 60 * 60_000 },
  } as const;
  const limit = limits[scope];
  const rl = await rateLimitDistributed(
    `webinar-resend-${scope}:${staff.id}`,
    limit.max,
    limit.windowMs
  );
  if (!rl.ok) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  const webinar = await ensureFreeWebinar();

  if (scope === "one") {
    if (!registrationId) {
      return NextResponse.json({ error: "missing_registration" }, { status: 400 });
    }
    const result = await resendWebinarMailToOne(registrationId, pass);
    fireAuditLog({
      staffUserId: staff.id,
      action: "UPDATE",
      entityType: "WebinarRegistration",
      entityId: registrationId,
      changes: { resend: pass, result },
    });
    return NextResponse.json(result, { status: result.ok ? 200 : 400 });
  }

  if (scope === "pending") {
    // Disparado a mano: se ignora la ventana del recordatorio. El cron sigue
    // respetándola; aquí la intención del operador manda.
    const result = await drainWebinarMail(pass, undefined, true);
    fireAuditLog({
      staffUserId: staff.id,
      action: "UPDATE",
      entityType: "FreeWebinar",
      entityId: webinar.id,
      changes: { resend: "pending", pass, result },
    });
    return NextResponse.json(result);
  }

  // Guardarraíl que sí carga peso: una edición archivada conserva su meetUrl
  // histórico, y reenviarlo mandaría un enlace muerto a una lista ya cerrada.
  if (webinar.slug !== FREE_WEBINAR_SLUG) {
    return NextResponse.json({ error: "not_live_edition" }, { status: 400 });
  }

  const result = await resendWebinarMailToAll(pass);
  fireAuditLog({
    staffUserId: staff.id,
    action: "UPDATE",
    entityType: "FreeWebinar",
    entityId: webinar.id,
    changes: { resend: "all", pass, result },
  });
  return NextResponse.json(result);
}
