import { NextResponse } from "next/server";
import { requireWriteStaff, resolveAdminStaff } from "@/lib/auth/api-staff";
import { fireAuditLog } from "@/lib/crm/audit";
import {
  clearWebinarVideo,
  createWebinarVideoUpload,
  ensureFreeWebinar,
  reconcileWebinarVideo,
} from "@/lib/crm/free-webinar";
import { isMuxConfigured } from "@/lib/mux/client";
import { muxNotConfiguredResponse } from "@/lib/mux/http";

export const dynamic = "force-dynamic";

/**
 * Vídeo promocional del webinar, sobre Mux.
 *
 * `POST` abre una subida directa (el navegador sube con UpChunk, sin pasar por
 * el servidor) y `GET` reconcilia el estado contra la API de Mux: el webhook
 * `video.asset.ready` no llega nunca en local — Mux no alcanza `localhost` —
 * y en producción uno perdido dejaría el vídeo colgado en «procesando».
 */

export async function POST() {
  const staff = await requireWriteStaff();
  if (staff instanceof NextResponse) return staff;
  if (!isMuxConfigured()) return muxNotConfiguredResponse();

  const upload = await createWebinarVideoUpload().catch((e) => {
    console.error("[webinar video upload]", e);
    return null;
  });
  if (!upload) {
    return NextResponse.json({ error: "upload_failed" }, { status: 502 });
  }

  const webinar = await ensureFreeWebinar();
  fireAuditLog({
    staffUserId: staff.id,
    action: "CREATE",
    entityType: "FreeWebinar",
    entityId: webinar.id,
    changes: { video: "mux_upload_started", uploadId: upload.uploadId },
  });

  return NextResponse.json(upload);
}

export async function GET() {
  const staff = await resolveAdminStaff();
  if (staff instanceof NextResponse) return staff;
  if (!isMuxConfigured()) return muxNotConfiguredResponse();

  const webinar = await reconcileWebinarVideo().catch((e) => {
    console.error("[webinar video reconcile]", e);
    return null;
  });
  if (!webinar) {
    return NextResponse.json({ error: "reconcile_failed" }, { status: 502 });
  }

  return NextResponse.json({ webinar });
}

export async function DELETE() {
  const staff = await requireWriteStaff();
  if (staff instanceof NextResponse) return staff;

  const webinar = await clearWebinarVideo();

  fireAuditLog({
    staffUserId: staff.id,
    action: "DELETE",
    entityType: "FreeWebinar",
    entityId: webinar.id,
    changes: { video: "cleared" },
  });

  return NextResponse.json({ webinar });
}
