import { NextResponse } from "next/server";
import { z } from "zod";

import { apiError, readJson, withStaff } from "@/lib/api/handler";
import { rateLimitDistributed } from "@/lib/api/rate-limit-distributed";
import { fireAuditLog } from "@/lib/crm/audit";
import {
  EVENT_WA_TEMPLATE_KEY,
  eventWaRemindersEnabled,
  sendEventWhatsAppReminders,
  setEventWaRemindersEnabled,
} from "@/lib/crm/event-whatsapp-reminders";
import { getFreeWebinar } from "@/lib/crm/free-webinar";
import { prisma } from "@/lib/db";
import { waReminderFlag, WHATSAPPABLE_CONTACT } from "@/lib/crm/webinar-registrations";
import { previewSend } from "@/lib/crm/whatsapp-sends";

export const dynamic = "force-dynamic";
// Cada llamada se corta a los 50 s; la página repite hasta terminar.
export const maxDuration = 300;

/**
 * Recordatorios del evento por WhatsApp, a mano: el respaldo por si el reloj
 * no corrió. Sin ventana (si Dayana lo pulsa, es que quiere que salga ya),
 * pero con el mismo reclamo por fila que el cron: nadie lo recibe dos veces.
 *
 * - GET `?pass=24h|1h`: vista previa — a cuántas, cuántas gratis (escribieron
 *   en 24 h), cuántas con plantilla y lo que costarían.
 * - POST `{ scope: "pending" | "one", pass, registrationId? }`: envía.
 * - PATCH `{ enabled }`: el interruptor de los automáticos.
 */
const PER_CALL_BUDGET_MS = 50_000;

const passSchema = z.enum(["24h", "1h"]);
const bodySchema = z.object({
  scope: z.enum(["pending", "one"]),
  pass: passSchema,
  registrationId: z.string().min(1).optional(),
});

export const GET = withStaff("read", async ({ req }) => {
  const pass = passSchema.safeParse(new URL(req.url).searchParams.get("pass") ?? "24h");
  if (!pass.success) return apiError("invalid_pass", 400);
  const live = await getFreeWebinar();
  if (!live) return apiError("no_event", 404);

  const rows = await prisma.webinarRegistration.findMany({
    where: { webinarId: live.id, [waReminderFlag(pass.data)]: null, contact: WHATSAPPABLE_CONTACT },
    select: { contactId: true },
    take: 2000,
  });
  const [preview, enabled] = await Promise.all([
    previewSend({ contactIds: rows.map((r) => r.contactId), templateKey: EVENT_WA_TEMPLATE_KEY, kind: "evento" }),
    eventWaRemindersEnabled(),
  ]);
  return NextResponse.json({
    pass: pass.data,
    enabled,
    event: {
      id: live.id,
      headline: live.headline,
      startsAtIso: live.startsAtIso,
      hasMeetUrl: Boolean(live.meetUrl),
      isActive: live.isActive,
      ended: Boolean(live.endedAt),
    },
    pending: rows.length,
    text: preview.text,
    template: preview.template,
    skipped: preview.skipped,
    estimatedCost: preview.estimatedCost,
    currency: preview.currency,
    templateApproved: (preview.templateInfo?.status ?? "").toUpperCase() === "APPROVED",
    templateStatus: preview.templateInfo?.status ?? null,
  });
});

export const POST = withStaff("write", async ({ req, staff }) => {
  const parsed = bodySchema.safeParse(await readJson(req));
  if (!parsed.success) return apiError("invalid_body", 400);
  const { scope, pass, registrationId } = parsed.data;

  const limit = scope === "one" ? { max: 30, windowMs: 60_000 } : { max: 60, windowMs: 60 * 60_000 };
  const rl = await rateLimitDistributed(`event-wa-${scope}:${staff.id}`, limit.max, limit.windowMs);
  if (!rl.ok) return apiError("rate_limited", 429);

  const live = await getFreeWebinar();
  if (!live) return apiError("no_event", 404);

  if (scope === "one") {
    if (!registrationId) return apiError("missing_registration", 400);
    const reg = await prisma.webinarRegistration.findUnique({
      where: { id: registrationId },
      select: { webinarId: true },
    });
    if (!reg) return apiError("not_found", 404);
    // Solo la edición viva: una archivada guarda un enlace que ya no sirve.
    if (reg.webinarId !== live.id) return apiError("wrong_webinar", 400);
    // Reintento: se suelta el sello de esa pasada y su error.
    await prisma.webinarRegistration.update({
      where: { id: registrationId },
      data: { [waReminderFlag(pass)]: null, waReminderError: null, waReminderErrorAt: null },
    });
  }

  const result = await sendEventWhatsAppReminders({
    pass,
    webinarId: live.id,
    budgetMs: PER_CALL_BUDGET_MS,
    ignoreWindow: true,
    ...(scope === "one" ? { registrationId } : {}),
  });

  fireAuditLog({
    staffUserId: staff.id,
    action: "WHATSAPP_SENT",
    entityType: scope === "one" ? "WebinarRegistration" : "FreeWebinar",
    entityId: scope === "one" ? registrationId! : live.id,
    changes: { source: "evento:recordatorio", scope, pass, result },
  });
  return NextResponse.json(result);
});

export const PATCH = withStaff("write", async ({ req, staff }) => {
  const parsed = z.object({ enabled: z.boolean() }).safeParse(await readJson(req));
  if (!parsed.success) return apiError("invalid_body", 400);
  await setEventWaRemindersEnabled(parsed.data.enabled);
  fireAuditLog({
    staffUserId: staff.id,
    action: "UPDATE",
    entityType: "SiteSetting",
    entityId: "free_event_wa_reminders",
    changes: { enabled: parsed.data.enabled },
  });
  return NextResponse.json({ enabled: parsed.data.enabled });
});
