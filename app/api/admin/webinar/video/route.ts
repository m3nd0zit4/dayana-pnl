import { NextResponse } from "next/server";
import { apiError, withStaff } from "@/lib/api/handler";
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

export const POST = withStaff("write", async ({ staff }) => {
  if (!isMuxConfigured()) return muxNotConfiguredResponse();

  const upload = await createWebinarVideoUpload().catch((e) => {
    console.error("[webinar video upload]", e);
    return null;
  });
  if (!upload) {
    return apiError("upload_failed", 502);
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
});

export const GET = withStaff("read", async () => {
  if (!isMuxConfigured()) return muxNotConfiguredResponse();

  const webinar = await reconcileWebinarVideo().catch((e) => {
    console.error("[webinar video reconcile]", e);
    return null;
  });
  if (!webinar) {
    return apiError("reconcile_failed", 502);
  }

  return NextResponse.json({ webinar });
});

export const DELETE = withStaff("write", async ({ staff }) => {
  const webinar = await clearWebinarVideo();

  fireAuditLog({
    staffUserId: staff.id,
    action: "DELETE",
    entityType: "FreeWebinar",
    entityId: webinar.id,
    changes: { video: "cleared" },
  });

  return NextResponse.json({ webinar });
});
