import { del, put } from "@vercel/blob";
import type { StaffUser } from "@prisma/client";
import { NextResponse, after, type NextRequest } from "next/server";
import { z } from "zod";

import { apiError, readJson } from "@/lib/api/handler";
import { rateLimitDistributed } from "@/lib/api/rate-limit-distributed";
import { requireBroadcastStaff, requireWriteStaff } from "@/lib/auth/api-staff";
import { fireAuditLog } from "@/lib/crm/audit";
import {
  EVENT_WA_TEMPLATE_KEY,
  eventWaRemindersEnabled,
  sendEventWhatsAppReminders,
  setEventWaRemindersEnabled,
} from "@/lib/crm/event-whatsapp-reminders";
import {
  clearWebinarMaterial,
  clearWebinarVideo,
  createWebinarVideoUpload,
  ensureFreeWebinar,
  getFreeEventById,
  getFreeWebinar,
  FREE_EVENT_LIFECYCLE_MESSAGE,
  FreeEventLifecycleError,
  FreeWebinarMeetUrlError,
  FreeWebinarPublishError,
  PUBLISH_BLOCKER_LABELS,
  reconcileWebinarVideo,
  setFreeWebinarEnded,
  setWebinarMaterial,
  updateFreeWebinar,
  type FreeWebinarFaqItem,
} from "@/lib/crm/free-webinar";
import { getOperationalTimezone } from "@/lib/crm/operational-timezone";
import { drainWebinarMail, resendWebinarMailToAll, resendWebinarMailToOne } from "@/lib/crm/webinar-mailer";
import {
  listPendingWaReminderContactIds,
  listWebinarRegistrations,
  registrationEventId,
  releaseWaReminder,
  webinarRegistrationStats,
} from "@/lib/crm/webinar-registrations";
import { previewSend } from "@/lib/crm/whatsapp-sends";
import { emitWebinarMeetLinkChanged } from "@/lib/inngest/events";
import { isMuxConfigured } from "@/lib/mux/client";
import { muxNotConfiguredResponse } from "@/lib/mux/http";
import { blobNotConfiguredResponse, isBlobConfigured } from "@/lib/storage/blob";
import { freeEventPatchSchema } from "@/lib/validations/free-event";

/**
 * Lo que hacen las rutas de un evento gratuito. Las comparten
 * `/api/admin/eventos/[id]/…` (un evento concreto) y las rutas viejas
 * `/api/admin/webinar/…`, que siguen funcionando sobre el evento actual: sin
 * `eventId`, el actual.
 */

type Ctx = { req: NextRequest; staff: StaffUser };

/** El id con el que se trabaja: el pedido o el del evento actual. */
const targetId = async (eventId?: string): Promise<string> =>
  eventId ?? (await ensureFreeWebinar()).id;

/** Errores de la biblioteca → respuesta con el mensaje en español. */
export const freeEventErrorResponse = (e: unknown): NextResponse | null => {
  if (e instanceof FreeWebinarMeetUrlError) {
    return apiError("invalid_meet_url", 400, {
      message: "El enlace de la reunión debe ser una URL https válida.",
    });
  }
  if (e instanceof FreeWebinarPublishError) {
    return apiError("not_publishable", 400, {
      blockers: e.blockers,
      message: `Falta: ${e.blockers.map((b) => PUBLISH_BLOCKER_LABELS[b]).join(", ")}`,
    });
  }
  if (e instanceof FreeEventLifecycleError) {
    return apiError(e.reason, e.reason === "not_found" ? 404 : 400, {
      message: FREE_EVENT_LIFECYCLE_MESSAGE[e.reason],
    });
  }
  if (e instanceof Error && e.message === "INVALID_ZONED_DATETIME") {
    return apiError("invalid_datetime", 400, { message: "Fecha u hora inválida." });
  }
  if (e instanceof Error && e.name === "NotFoundError") return apiError("not_found", 404);
  if (
    e &&
    typeof e === "object" &&
    "code" in e &&
    (e as { code?: string }).code === "P2025"
  ) {
    return apiError("not_found", 404);
  }
  return null;
};

/* -------------------------------------------------------------------------
 * La página
 * ---------------------------------------------------------------------- */

export const getEvent = async (eventId?: string) => {
  const webinar = await ensureFreeWebinar(eventId).catch(() => null);
  if (!webinar) return apiError("not_found", 404);
  return NextResponse.json({ webinar, operationalTimezone: await getOperationalTimezone() });
};

export const patchEvent = async ({ req, staff }: Ctx, eventId?: string) => {
  const parsed = freeEventPatchSchema.safeParse(await readJson(req));
  if (!parsed.success) return apiError("invalid_body", 400);

  const faq = parsed.data.faq as FreeWebinarFaqItem[] | undefined;
  const { startsAtIso, startsAtLocal, ended, ...rest } = parsed.data;
  const actor = { staffUserId: staff.id };

  try {
    if (ended !== undefined) {
      const webinar = await setFreeWebinarEnded(ended, eventId, actor);
      fireAuditLog({
        staffUserId: staff.id,
        action: "UPDATE",
        entityType: "FreeWebinar",
        entityId: webinar.id,
        changes: { ended },
      });
      return NextResponse.json({ webinar, operationalTimezone: await getOperationalTimezone() });
    }

    const { webinar, meetUrlChanged, startsAtChanged, linkEmailsReset, closedOthers } =
      await updateFreeWebinar(
        {
          ...rest,
          faq,
          startsAt:
            startsAtIso === undefined ? undefined : startsAtIso === null ? null : new Date(startsAtIso),
          startsAtLocal: startsAtLocal === undefined ? undefined : startsAtLocal,
        },
        eventId,
        actor
      );

    // Enlace nuevo o cambiado: se envía ya. Si Inngest no está configurado
    // (local, o la variable sin poner) se hace en línea con `after()` — un
    // enlace guardado no puede quedarse esperando a que alguien configure algo.
    if (meetUrlChanged && webinar.meetUrl) {
      const queued = await emitWebinarMeetLinkChanged(webinar.id);
      if (!queued) {
        const id = webinar.id;
        after(async () => {
          await drainWebinarMail("link", undefined, false, id);
        });
      }
    }

    fireAuditLog({
      staffUserId: staff.id,
      action: "UPDATE",
      entityType: "FreeWebinar",
      entityId: webinar.id,
      changes: {
        status: webinar.status,
        fields: Object.keys(parsed.data),
        startsAtIso: webinar.startsAtIso,
        meetUrlChanged,
        startsAtChanged,
        closedOthers: closedOthers.map((o) => o.id),
      },
    });

    return NextResponse.json({
      webinar,
      meetUrlChanged,
      startsAtChanged,
      linkEmailsReset,
      closedOthers,
      operationalTimezone: await getOperationalTimezone(),
    });
  } catch (e) {
    const res = freeEventErrorResponse(e);
    if (res) return res;
    throw e;
  }
};

/* -------------------------------------------------------------------------
 * Material
 * ---------------------------------------------------------------------- */

/** Un documento de apoyo, no un vídeo: 25 MB cubre de sobra un PDF o un Word. */
const MAX_MATERIAL_BYTES = 25 * 1024 * 1024;

const ALLOWED_MIMES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);

/**
 * Sube por FormData al servidor, no directo desde el navegador: es un único
 * archivo pequeño, así que el límite de cuerpo de la función no estorba. El
 * blob es privado y se sirve por `/api/webinar/material?evento=<id>`.
 */
export const postMaterial = async ({ req, staff }: Ctx, eventId?: string) => {
  if (!isBlobConfigured()) return blobNotConfiguredResponse();

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return apiError("missing_file", 400);
  if (file.size > MAX_MATERIAL_BYTES) return apiError("file_too_large", 400);
  const mime = file.type || "application/octet-stream";
  if (!ALLOWED_MIMES.has(mime)) return apiError("invalid_mime", 400);

  const id = await targetId(eventId);
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 150);
  const blob = await put(`webinar/${id}/material/${Date.now()}-${safeName}`, file, {
    access: "private",
    contentType: mime,
  });

  const { webinar, previousUrl } = await setWebinarMaterial(
    { url: blob.url, fileName: file.name.slice(0, 200), mimeType: mime, sizeBytes: file.size },
    id,
    { staffUserId: staff.id }
  );
  // Reemplazar sin borrar el anterior deja un huérfano pagando almacenamiento.
  // Solo se borra si ningún otro evento lo comparte (copiar la página lo hace).
  if (previousUrl) await del(previousUrl).catch(() => {});

  fireAuditLog({
    staffUserId: staff.id,
    action: "UPDATE",
    entityType: "FreeWebinar",
    entityId: webinar.id,
    changes: { material: file.name, sizeBytes: file.size },
  });
  return NextResponse.json({ webinar });
};

export const deleteMaterial = async ({ staff }: Pick<Ctx, "staff">, eventId?: string) => {
  const { webinar, previousUrl } = await clearWebinarMaterial(await targetId(eventId));
  if (previousUrl) await del(previousUrl).catch(() => {});
  fireAuditLog({
    staffUserId: staff.id,
    action: "UPDATE",
    entityType: "FreeWebinar",
    entityId: webinar.id,
    changes: { material: null },
  });
  return NextResponse.json({ webinar });
};

/* -------------------------------------------------------------------------
 * Vídeo (Mux)
 * ---------------------------------------------------------------------- */

/** `POST` abre una subida directa (el navegador sube con UpChunk). */
export const postVideo = async ({ staff }: Pick<Ctx, "staff">, eventId?: string) => {
  if (!isMuxConfigured()) return muxNotConfiguredResponse();
  const upload = await createWebinarVideoUpload(await targetId(eventId)).catch((e) => {
    console.error("[webinar video upload]", e);
    return null;
  });
  if (!upload) return apiError("upload_failed", 502);
  fireAuditLog({
    staffUserId: staff.id,
    action: "CREATE",
    entityType: "FreeWebinar",
    entityId: upload.eventId,
    changes: { video: "mux_upload_started", uploadId: upload.uploadId },
  });
  return NextResponse.json({ uploadUrl: upload.uploadUrl, uploadId: upload.uploadId });
};

/**
 * `GET` reconcilia contra la API de Mux: el webhook no llega nunca en local, y
 * en producción uno perdido dejaría el vídeo colgado en «procesando».
 */
export const getVideo = async (eventId?: string) => {
  if (!isMuxConfigured()) return muxNotConfiguredResponse();
  const webinar = await reconcileWebinarVideo(await targetId(eventId)).catch((e) => {
    console.error("[webinar video reconcile]", e);
    return null;
  });
  if (!webinar) return apiError("reconcile_failed", 502);
  return NextResponse.json({ webinar });
};

export const deleteVideo = async ({ staff }: Pick<Ctx, "staff">, eventId?: string) => {
  const webinar = await clearWebinarVideo(await targetId(eventId));
  fireAuditLog({
    staffUserId: staff.id,
    action: "DELETE",
    entityType: "FreeWebinar",
    entityId: webinar.id,
    changes: { video: "cleared" },
  });
  return NextResponse.json({ webinar });
};

/* -------------------------------------------------------------------------
 * Inscritas
 * ---------------------------------------------------------------------- */

const MAX_TAKE = 100;

/**
 * Lista paginada de inscritas. El panel se pinta con las 50 más recientes:
 * sin búsqueda ni paginación no se llegaría a nadie más allá.
 */
export const getRegistrations = async ({ req }: Pick<Ctx, "req">, eventId?: string) => {
  const url = new URL(req.url);
  const webinarId = eventId ?? (url.searchParams.get("webinarId")?.trim() || (await targetId()));

  const take = Math.min(Math.max(Number(url.searchParams.get("take") ?? 50) || 50, 1), MAX_TAKE);
  const skip = Math.max(Number(url.searchParams.get("skip") ?? 0) || 0, 0);
  const q = url.searchParams.get("q") ?? undefined;
  const failedOnly = url.searchParams.get("failedOnly") === "true";

  const [rows, stats] = await Promise.all([
    listWebinarRegistrations(webinarId, { take, skip, q, failedOnly }),
    skip === 0 ? webinarRegistrationStats(webinarId) : Promise.resolve(null),
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
      notifyWhatsapp: r.contact.notifyWhatsapp,
      reminder24hWaSentAt: r.reminder24hWaSentAt?.toISOString() ?? null,
      reminder1hWaSentAt: r.reminder1hWaSentAt?.toISOString() ?? null,
      waReminderError: r.waReminderError,
      confirmationWaSentAt: r.confirmationWaSentAt?.toISOString() ?? null,
      confirmationWaError: r.confirmationWaError,
    })),
    stats,
    hasMore: rows.length === take,
  });
};

/**
 * Reenvío manual de los correos. Los barridos ya reintentan solos; esto es
 * para forzarlo. Los tres alcances tienen permisos y límites distintos: `all`
 * puede ser un envío de 10k correos y es el más caro de deshacer.
 */
const resendSchema = z.object({
  scope: z.enum(["one", "pending", "all"]),
  pass: z.enum(["link", "24h", "1h"]),
  registrationId: z.string().min(1).optional(),
});

export const postResend = async (req: NextRequest, eventId?: string) => {
  const parsed = resendSchema.safeParse(await readJson(req));
  if (!parsed.success) return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  const { scope, pass, registrationId } = parsed.data;

  // `all` es OWNER: la convención de la casa para envíos masivos.
  const staff = scope === "all" ? await requireBroadcastStaff() : await requireWriteStaff();
  if (staff instanceof NextResponse) return staff;

  const limits = {
    one: { max: 30, windowMs: 60_000 },
    // Un barrido de pendientes es idempotente. Con 5/hora, durante un evento
    // en vivo el botón se bloquearía justo cuando más se usa.
    pending: { max: 20, windowMs: 60 * 60_000 },
    all: { max: 2, windowMs: 24 * 60 * 60_000 },
  } as const;
  const limit = limits[scope];
  const rl = await rateLimitDistributed(`webinar-resend-${scope}:${staff.id}`, limit.max, limit.windowMs);
  if (!rl.ok) return NextResponse.json({ error: "rate_limited" }, { status: 429 });

  if (scope === "one") {
    if (!registrationId) return NextResponse.json({ error: "missing_registration" }, { status: 400 });
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

  const webinarId = await targetId(eventId);
  if (scope === "pending") {
    // Disparado a mano: sin ventana. El reloj sigue respetándola.
    const result = await drainWebinarMail(pass, undefined, true, webinarId);
    fireAuditLog({
      staffUserId: staff.id,
      action: "UPDATE",
      entityType: "FreeWebinar",
      entityId: webinarId,
      changes: { resend: "pending", pass, result },
    });
    return NextResponse.json(result);
  }

  // Guardarraíl: un evento ya realizado conserva su meetUrl histórico, y
  // reenviarlo a todas mandaría un enlace muerto a una lista ya cerrada.
  const event = await getFreeEventById(webinarId);
  if (!event || event.status === "COMPLETED" || event.endedAt) {
    return NextResponse.json({ error: "not_live_edition" }, { status: 400 });
  }
  const result = await resendWebinarMailToAll(pass, webinarId);
  fireAuditLog({
    staffUserId: staff.id,
    action: "UPDATE",
    entityType: "FreeWebinar",
    entityId: webinarId,
    changes: { resend: "all", pass, result },
  });
  return NextResponse.json(result);
};

/* -------------------------------------------------------------------------
 * Recordatorios por WhatsApp, a mano
 * ---------------------------------------------------------------------- */

const WA_PER_CALL_BUDGET_MS = 50_000;
const waPassSchema = z.enum(["24h", "1h"]);
const waBodySchema = z.object({
  scope: z.enum(["pending", "one"]),
  pass: waPassSchema,
  registrationId: z.string().min(1).optional(),
});

/** Vista previa: a cuántas, cuántas gratis, cuántas con plantilla y el costo. */
export const getWaReminders = async ({ req }: Pick<Ctx, "req">, eventId?: string) => {
  const pass = waPassSchema.safeParse(new URL(req.url).searchParams.get("pass") ?? "24h");
  if (!pass.success) return apiError("invalid_pass", 400);
  const event = await getFreeWebinar(eventId);
  if (!event) return apiError("no_event", 404);

  const contactIds = await listPendingWaReminderContactIds(event.id, pass.data);
  const [preview, enabled] = await Promise.all([
    previewSend({ contactIds, templateKey: EVENT_WA_TEMPLATE_KEY, kind: "evento" }),
    eventWaRemindersEnabled(),
  ]);
  return NextResponse.json({
    pass: pass.data,
    enabled,
    event: {
      id: event.id,
      headline: event.headline,
      startsAtIso: event.startsAtIso,
      hasMeetUrl: Boolean(event.meetUrl),
      isActive: event.isActive,
      status: event.status,
      ended: Boolean(event.endedAt),
    },
    pending: contactIds.length,
    text: preview.text,
    template: preview.template,
    skipped: preview.skipped,
    estimatedCost: preview.estimatedCost,
    currency: preview.currency,
    templateApproved: (preview.templateInfo?.status ?? "").toUpperCase() === "APPROVED",
    templateStatus: preview.templateInfo?.status ?? null,
  });
};

/**
 * Enviar a mano: el respaldo si el reloj no corrió. Sin ventana, con el mismo
 * reclamo por fila: nadie lo recibe dos veces.
 */
export const postWaReminders = async ({ req, staff }: Ctx, eventId?: string) => {
  const parsed = waBodySchema.safeParse(await readJson(req));
  if (!parsed.success) return apiError("invalid_body", 400);
  const { scope, pass, registrationId } = parsed.data;

  const limit = scope === "one" ? { max: 30, windowMs: 60_000 } : { max: 60, windowMs: 60 * 60_000 };
  const rl = await rateLimitDistributed(`event-wa-${scope}:${staff.id}`, limit.max, limit.windowMs);
  if (!rl.ok) return apiError("rate_limited", 429);

  const event = await getFreeWebinar(eventId);
  if (!event) return apiError("no_event", 404);

  if (scope === "one") {
    if (!registrationId) return apiError("missing_registration", 400);
    const regEventId = await registrationEventId(registrationId);
    if (!regEventId) return apiError("not_found", 404);
    if (regEventId !== event.id) return apiError("wrong_webinar", 400);
    // Reintento: se suelta el sello de esa pasada y su error.
    await releaseWaReminder(registrationId, pass);
  }

  const result = await sendEventWhatsAppReminders({
    pass,
    webinarId: event.id,
    budgetMs: WA_PER_CALL_BUDGET_MS,
    ignoreWindow: true,
    ...(scope === "one" ? { registrationId } : {}),
  });

  fireAuditLog({
    staffUserId: staff.id,
    action: "WHATSAPP_SENT",
    entityType: scope === "one" ? "WebinarRegistration" : "FreeWebinar",
    entityId: scope === "one" ? registrationId! : event.id,
    changes: { source: "evento:recordatorio", scope, pass, result },
  });
  return NextResponse.json(result);
};

/** El interruptor de los recordatorios automáticos (de todos los eventos). */
export const patchWaReminders = async ({ req, staff }: Ctx) => {
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
};
