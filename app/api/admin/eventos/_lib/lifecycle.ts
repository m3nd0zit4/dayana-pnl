import { del } from "@vercel/blob";
import { NextResponse } from "next/server";

import { apiError } from "@/lib/api/handler";
import { fireAuditLog } from "@/lib/crm/audit";
import {
  createFreeEvent,
  deleteFreeEvent,
  duplicateFreeEvent,
  endFreeEvent,
  getFreeEventById,
  publishFreeEvent,
  reopenFreeEvent,
  resolveWebinarCloseAt,
  unpublishFreeEvent,
  type CreateFreeEventInput,
} from "@/lib/crm/free-webinar";
import { freeEventEditionsEnabled } from "@/lib/crm/free-event-settings";
import { freeEventErrorResponse } from "./handlers";

/**
 * El ciclo de un evento (crear, publicar, cerrar inscripciones, terminar,
 * reabrir, duplicar, borrar), compartido por las rutas de `/api/admin/eventos`.
 * Cada paso queda en su historia (`free_event_activities`) y en la auditoría.
 */

const run = async (fn: () => Promise<NextResponse>): Promise<NextResponse> => {
  try {
    return await fn();
  } catch (e) {
    const res = freeEventErrorResponse(e);
    if (res) return res;
    throw e;
  }
};

const audit = (staffUserId: string, entityId: string, action: string, changes: Record<string, unknown>) =>
  fireAuditLog({ staffUserId, action, entityType: "FreeWebinar", entityId, changes });

export const createEventResponse = (input: CreateFreeEventInput, staffUserId: string) =>
  run(async () => {
    if (!(await freeEventEditionsEnabled())) {
      return apiError("editions_disabled", 403, { message: "Crear eventos está apagado por ahora." });
    }
    const webinar = await createFreeEvent(input, { staffUserId });
    audit(staffUserId, webinar.id, "CREATE", { copiedFrom: input.copyFromId ?? null });
    return NextResponse.json({ webinar }, { status: 201 });
  });

export const duplicateEventResponse = (id: string, staffUserId: string) =>
  run(async () => {
    if (!(await freeEventEditionsEnabled())) {
      return apiError("editions_disabled", 403, { message: "Crear eventos está apagado por ahora." });
    }
    const webinar = await duplicateFreeEvent(id, { staffUserId });
    audit(staffUserId, webinar.id, "CREATE", { copiedFrom: id });
    return NextResponse.json({ webinar }, { status: 201 });
  });

export const publishEventResponse = (id: string, staffUserId: string) =>
  run(async () => {
    const { webinar, closed } = await publishFreeEvent(id, { staffUserId });
    audit(staffUserId, id, "UPDATE", { published: true, closedOthers: closed.map((c) => c.id) });
    return NextResponse.json({ webinar, closed });
  });

export const unpublishEventResponse = (id: string, staffUserId: string) =>
  run(async () => {
    const webinar = await unpublishFreeEvent(id, { staffUserId });
    audit(staffUserId, id, "UPDATE", { unpublished: true });
    return NextResponse.json({ webinar });
  });

export const endEventResponse = (id: string, staffUserId: string) =>
  run(async () => {
    const ended = await endFreeEvent(id, { by: "staff", staffUserId });
    const webinar = await getFreeEventById(id);
    if (!webinar) return apiError("not_found", 404);
    audit(staffUserId, id, "UPDATE", { ended: true, changed: ended });
    return NextResponse.json({ webinar });
  });

export const reopenEventResponse = (id: string, staffUserId: string) =>
  run(async () => {
    const webinar = await reopenFreeEvent(id, { staffUserId });
    audit(staffUserId, id, "UPDATE", { ended: false });
    // Reabierto con la fecha ya pasada: publicarlo pide antes otra fecha.
    const closeAt = resolveWebinarCloseAt(webinar, webinar.operationalTimezone);
    const notice =
      closeAt && Date.now() >= closeAt.getTime()
        ? "Reabierto. La fecha ya pasó: cámbiala en «Página» antes de publicar."
        : undefined;
    return NextResponse.json({ webinar, notice });
  });

export const deleteEventResponse = (id: string, staffUserId: string) =>
  run(async () => {
    const { materialUrl } = await deleteFreeEvent(id);
    if (materialUrl) await del(materialUrl).catch(() => {});
    audit(staffUserId, id, "DELETE", { deletedEvent: true });
    return NextResponse.json({ ok: true });
  });
