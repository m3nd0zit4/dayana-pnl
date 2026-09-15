import { del, put } from "@vercel/blob";
import { NextResponse } from "next/server";
import { apiError, withStaff } from "@/lib/api/handler";
import { fireAuditLog } from "@/lib/crm/audit";
import {
  clearWebinarMaterial,
  ensureFreeWebinar,
  setWebinarMaterial,
} from "@/lib/crm/free-webinar";
import { blobNotConfiguredResponse, isBlobConfigured } from "@/lib/storage/blob";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Un documento de apoyo, no un vídeo: 25 MB cubre de sobra un PDF o un Word. */
const MAX_BYTES = 25 * 1024 * 1024;

const ALLOWED_MIMES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);

/**
 * Material descargable del webinar gratuito.
 *
 * Sube por FormData al servidor, no directo desde el navegador: es un único
 * archivo pequeño, así que el límite de cuerpo de la función no estorba y se
 * evita el intercambio de tokens que sí necesita el vídeo.
 *
 * El blob es privado y se sirve por `/api/webinar/material`; la URL real nunca
 * sale de aquí.
 */
export const POST = withStaff("write", async ({ req, staff }) => {
  if (!isBlobConfigured()) return blobNotConfiguredResponse();

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) {
    return apiError("missing_file", 400);
  }
  if (file.size > MAX_BYTES) {
    return apiError("file_too_large", 400);
  }

  const mime = file.type || "application/octet-stream";
  if (!ALLOWED_MIMES.has(mime)) {
    return apiError("invalid_mime", 400);
  }

  const webinar = await ensureFreeWebinar();
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 150);
  const blob = await put(
    `webinar/${webinar.id}/material/${Date.now()}-${safeName}`,
    file,
    { access: "private", contentType: mime }
  );

  const { webinar: updated, previousUrl } = await setWebinarMaterial({
    url: blob.url,
    fileName: file.name.slice(0, 200),
    mimeType: mime,
    sizeBytes: file.size,
  });

  // Reemplazar sin borrar el anterior deja un huérfano pagando almacenamiento
  // para siempre. Es best-effort: si falla, el material nuevo ya está guardado.
  if (previousUrl) {
    await del(previousUrl).catch(() => {});
  }

  fireAuditLog({
    staffUserId: staff.id,
    action: "UPDATE",
    entityType: "FreeWebinar",
    entityId: updated.id,
    changes: { material: file.name, sizeBytes: file.size },
  });

  return NextResponse.json({ webinar: updated });
});

export const DELETE = withStaff("write", async ({ staff }) => {
  const { webinar, previousUrl } = await clearWebinarMaterial();
  if (previousUrl) {
    await del(previousUrl).catch(() => {});
  }

  fireAuditLog({
    staffUserId: staff.id,
    action: "UPDATE",
    entityType: "FreeWebinar",
    entityId: webinar.id,
    changes: { material: null },
  });

  return NextResponse.json({ webinar });
});
