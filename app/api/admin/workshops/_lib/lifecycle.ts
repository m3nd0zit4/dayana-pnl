import { del } from "@vercel/blob";
import type { StaffUser, WorkshopEdition } from "@prisma/client";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { apiError, readJson } from "@/lib/api/handler";
import { rateLimitDistributed } from "@/lib/api/rate-limit-distributed";
import { fireAuditLog } from "@/lib/crm/audit";
import { getOperationalTimezone, zonedDateTimeToUtc } from "@/lib/crm/operational-timezone";
import { createWorkshopEdition, duplicateWorkshopEdition } from "@/lib/crm/workshop-editions";
import {
  deleteWorkshopEdition,
  endWorkshopEdition,
  publishWorkshopEdition,
  reopenWorkshopEdition,
  unpublishWorkshopEdition,
  WORKSHOP_LIFECYCLE_MESSAGE,
  WorkshopLifecycleError,
  WorkshopPublishError,
} from "@/lib/crm/workshop-lifecycle";
import {
  enrollmentEditionId,
  getWorkshopTimeline,
  listWorkshopEnrollments,
  workshopEnrollmentStats,
} from "@/lib/crm/workshop-panel";
import {
  listPendingWorkshopWaContactIds,
  releaseWorkshopWaReminder,
  sendWorkshopWhatsAppReminders,
  setWorkshopWaRemindersEnabled,
  WORKSHOP_WA_REMINDERS_SETTING,
  WORKSHOP_WA_TEMPLATE_KEY,
  workshopWaRemindersEnabled,
} from "@/lib/crm/workshop-whatsapp-reminders";
import { previewSend } from "@/lib/crm/whatsapp-sends";
import { prisma } from "@/lib/db";
import { isVirtualWorkshopSlug } from "@/lib/workshops";

/**
 * Lo que hacen las rutas de `/api/admin/workshops/[slug]/…`: el ciclo de una
 * edición (como el de los eventos), sus inscritas y sus recordatorios por
 * WhatsApp. Cada paso queda en su historia y en la auditoría.
 */

type Ctx = { req: NextRequest; staff: StaffUser };

/** Errores de la biblioteca → respuesta con el mensaje en español. */
export const workshopErrorResponse = (e: unknown): NextResponse | null => {
  if (e instanceof WorkshopPublishError) {
    return apiError("not_publishable", 400, { blockers: e.blockers, message: e.messageEs });
  }
  if (e instanceof WorkshopLifecycleError) {
    return apiError(e.reason, e.reason === "not_found" ? 404 : 400, {
      message: WORKSHOP_LIFECYCLE_MESSAGE[e.reason],
    });
  }
  if (e instanceof Error && e.message === "INVALID_ZONED_DATETIME") {
    return apiError("invalid_datetime", 400, { message: "Fecha u hora inválida." });
  }
  if (e && typeof e === "object" && "code" in e && (e as { code?: string }).code === "P2025") {
    return apiError("not_found", 404);
  }
  return null;
};

const run = async (fn: () => Promise<Response>): Promise<Response> => {
  try {
    return await fn();
  } catch (e) {
    const res = workshopErrorResponse(e);
    if (res) return res;
    throw e;
  }
};

const audit = (staffUserId: string, entityId: string, action: string, changes: Record<string, unknown>) =>
  fireAuditLog({ staffUserId, action, entityType: "WorkshopEdition", entityId, changes });

/** La edición por su URL; el marcador «próximo taller» no es una edición. */
export const findEdition = async (slug: string): Promise<WorkshopEdition | null> => {
  if (isVirtualWorkshopSlug(slug)) return null;
  return prisma.workshopEdition.findUnique({ where: { slug } });
};

const withEdition = (slug: string, fn: (e: WorkshopEdition) => Promise<Response>) =>
  run(async () => {
    const edition = await findEdition(slug);
    if (!edition) return apiError("not_found", 404, { message: WORKSHOP_LIFECYCLE_MESSAGE.not_found });
    return fn(edition);
  });

/** Una fecha del panel (día + hora opcional, en la zona del CRM) → instante. */
export const startsAtFromLocal = async (
  local: { date: string; time?: string | null } | null | undefined
): Promise<Date | null | undefined> => {
  if (local === undefined) return undefined;
  if (local === null) return null;
  const tz = await getOperationalTimezone();
  const time = local.time?.trim() ?? "";
  return zonedDateTimeToUtc(local.date, /^\d{1,2}:\d{2}$/.test(time) ? time : "12:00", tz);
};

/* -------------------------------------------------------------------------
 * Crear y duplicar
 * ---------------------------------------------------------------------- */

export const workshopCreateSchema = z.object({
  title: z.string().trim().max(200).nullish(),
  startsAtLocal: z
    .object({
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      time: z
        .string()
        .regex(/^\d{1,2}:\d{2}$/)
        .nullish(),
    })
    .nullish(),
  copyFromId: z.string().trim().max(64).nullish(),
});

export const createWorkshopResponse = ({ req, staff }: Ctx) =>
  run(async () => {
    const parsed = workshopCreateSchema.safeParse((await readJson(req)) ?? {});
    if (!parsed.success) return apiError("invalid_body", 400);
    const edition = await createWorkshopEdition(
      {
        title: parsed.data.title ?? null,
        startsAt: (await startsAtFromLocal(parsed.data.startsAtLocal ?? null)) ?? null,
        copyFromId: parsed.data.copyFromId ?? null,
      },
      { staffUserId: staff.id }
    );
    audit(staff.id, edition.id, "CREATE", { copiedFrom: parsed.data.copyFromId ?? null });
    return NextResponse.json({ edition }, { status: 201 });
  });

export const duplicateWorkshopResponse = (slug: string, staff: StaffUser) =>
  withEdition(slug, async (source) => {
    const edition = await duplicateWorkshopEdition(source.id, { staffUserId: staff.id });
    audit(staff.id, edition.id, "CREATE", { copiedFrom: source.id });
    return NextResponse.json({ edition }, { status: 201 });
  });

/* -------------------------------------------------------------------------
 * Publicar, cerrar, terminar, reabrir, borrar
 * ---------------------------------------------------------------------- */

export const publishWorkshopResponse = (slug: string, staff: StaffUser) =>
  withEdition(slug, async (e) => {
    const { edition, closed } = await publishWorkshopEdition(e.id, { staffUserId: staff.id });
    audit(staff.id, e.id, "UPDATE", { published: true, closedOthers: closed.map((c) => c.id) });
    return NextResponse.json({ edition, closed });
  });

export const unpublishWorkshopResponse = (slug: string, staff: StaffUser) =>
  withEdition(slug, async (e) => {
    const edition = await unpublishWorkshopEdition(e.id, { staffUserId: staff.id });
    audit(staff.id, e.id, "UPDATE", { unpublished: true });
    return NextResponse.json({ edition });
  });

export const endWorkshopResponse = (slug: string, staff: StaffUser) =>
  withEdition(slug, async (e) => {
    const changed = await endWorkshopEdition(e.id, { by: "staff", staffUserId: staff.id });
    audit(staff.id, e.id, "UPDATE", { ended: true, changed });
    return NextResponse.json({ edition: await prisma.workshopEdition.findUnique({ where: { id: e.id } }) });
  });

export const reopenWorkshopResponse = (slug: string, staff: StaffUser) =>
  withEdition(slug, async (e) => {
    const edition = await reopenWorkshopEdition(e.id, { staffUserId: staff.id });
    audit(staff.id, e.id, "UPDATE", { ended: false });
    return NextResponse.json({ edition });
  });

export const deleteWorkshopResponse = (slug: string, staff: StaffUser) =>
  withEdition(slug, async (e) => {
    const { documentUrls } = await deleteWorkshopEdition(e.id);
    // Los documentos eran solo de esta edición (duplicar no los copia).
    await Promise.all(documentUrls.map((url) => del(url).catch(() => undefined)));
    audit(staff.id, e.id, "DELETE", { deletedWorkshop: true });
    return NextResponse.json({ ok: true });
  });

export const timelineWorkshopResponse = (slug: string) =>
  withEdition(slug, async (e) =>
    NextResponse.json({ timeline: await getWorkshopTimeline(e.id, await getOperationalTimezone()) })
  );

/* -------------------------------------------------------------------------
 * Inscritas
 * ---------------------------------------------------------------------- */

const MAX_TAKE = 100;

export const getEnrollmentsResponse = (req: NextRequest, slug: string) =>
  withEdition(slug, async (e) => {
    const url = new URL(req.url);
    const take = Math.min(Math.max(Number(url.searchParams.get("take") ?? 50) || 50, 1), MAX_TAKE);
    const skip = Math.max(Number(url.searchParams.get("skip") ?? 0) || 0, 0);
    const q = url.searchParams.get("q") ?? undefined;
    const failedOnly = url.searchParams.get("failedOnly") === "true";
    const [enrollments, stats] = await Promise.all([
      listWorkshopEnrollments(e.id, { take, skip, q, failedOnly }),
      skip === 0 ? workshopEnrollmentStats(e.id) : Promise.resolve(null),
    ]);
    return NextResponse.json({ enrollments, stats, hasMore: enrollments.length === take });
  });

/* -------------------------------------------------------------------------
 * Recordatorios por WhatsApp, a mano
 * ---------------------------------------------------------------------- */

const WA_PER_CALL_BUDGET_MS = 50_000;
const waPassSchema = z.enum(["24h", "1h"]);
const waBodySchema = z.object({
  scope: z.enum(["pending", "one"]),
  pass: waPassSchema,
  enrollmentId: z.string().min(1).optional(),
});

/** Vista previa: a cuántas, cuántas gratis, cuántas con plantilla y el costo. */
export const getWaRemindersResponse = (req: NextRequest, slug: string) =>
  withEdition(slug, async (e) => {
    const pass = waPassSchema.safeParse(new URL(req.url).searchParams.get("pass") ?? "24h");
    if (!pass.success) return apiError("invalid_pass", 400);
    const contactIds = await listPendingWorkshopWaContactIds(e.id, pass.data);
    const [preview, enabled] = await Promise.all([
      previewSend({ contactIds, templateKey: WORKSHOP_WA_TEMPLATE_KEY, kind: "taller" }),
      workshopWaRemindersEnabled(),
    ]);
    return NextResponse.json({
      pass: pass.data,
      enabled,
      pending: contactIds.length,
      text: preview.text,
      template: preview.template,
      skipped: preview.skipped,
      estimatedCost: preview.estimatedCost,
      currency: preview.currency,
      templateApproved: (preview.templateInfo?.status ?? "").toUpperCase() === "APPROVED",
      templateStatus: preview.templateInfo?.status ?? null,
    });
  });

/**
 * Enviar a mano: el respaldo si el reloj no corrió. Sin ventana, con el mismo
 * reclamo por fila: nadie lo recibe dos veces.
 */
export const postWaRemindersResponse = ({ req, staff }: Ctx, slug: string) =>
  withEdition(slug, async (e) => {
    const parsed = waBodySchema.safeParse(await readJson(req));
    if (!parsed.success) return apiError("invalid_body", 400);
    const { scope, pass, enrollmentId } = parsed.data;

    const limit = scope === "one" ? { max: 30, windowMs: 60_000 } : { max: 60, windowMs: 60 * 60_000 };
    const rl = await rateLimitDistributed(`workshop-wa-${scope}:${staff.id}`, limit.max, limit.windowMs);
    if (!rl.ok) return apiError("rate_limited", 429);

    if (scope === "one") {
      if (!enrollmentId) return apiError("missing_enrollment", 400);
      const editionId = await enrollmentEditionId(enrollmentId);
      if (!editionId) return apiError("not_found", 404);
      if (editionId !== e.id) return apiError("wrong_edition", 400);
      // Reintento: se suelta el sello de esa pasada y su error.
      await releaseWorkshopWaReminder(enrollmentId, pass);
    }

    const result = await sendWorkshopWhatsAppReminders({
      pass,
      editionId: e.id,
      budgetMs: WA_PER_CALL_BUDGET_MS,
      ignoreWindow: true,
      ...(scope === "one" ? { enrollmentId } : {}),
    });
    fireAuditLog({
      staffUserId: staff.id,
      action: "WHATSAPP_SENT",
      entityType: scope === "one" ? "Enrollment" : "WorkshopEdition",
      entityId: scope === "one" ? enrollmentId! : e.id,
      changes: { source: "taller:recordatorio", scope, pass, result },
    });
    return NextResponse.json(result);
  });

/** El interruptor de los recordatorios automáticos de los talleres (todos). */
export const patchWaRemindersResponse = async ({ req, staff }: Ctx) => {
  const parsed = z.object({ enabled: z.boolean() }).safeParse(await readJson(req));
  if (!parsed.success) return apiError("invalid_body", 400);
  await setWorkshopWaRemindersEnabled(parsed.data.enabled);
  fireAuditLog({
    staffUserId: staff.id,
    action: "UPDATE",
    entityType: "SiteSetting",
    entityId: WORKSHOP_WA_REMINDERS_SETTING,
    changes: { enabled: parsed.data.enabled },
  });
  return NextResponse.json({ enabled: parsed.data.enabled });
};
