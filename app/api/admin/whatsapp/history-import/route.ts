import { after, NextResponse } from "next/server";

import { apiError, withStaff } from "@/lib/api/handler";
import { fireAuditLog } from "@/lib/crm/audit";
import {
  getHistoryImportStatus,
  processHistoryUpload,
  saveHistoryPart,
} from "@/lib/crm/whatsapp-agent/history-import";
import { blobNotConfiguredResponse, isBlobConfigured } from "@/lib/storage/blob";

export const dynamic = "force-dynamic";
// Procesar meses de chats y calcular sus vectores lleva su rato.
export const maxDuration = 300;

const ID_RE = /^[a-z0-9-]{8,64}$/;
const MAX_PART = 4 * 1024 * 1024;

/** Estado de la última importación. */
export const GET = withStaff("owner", async () => NextResponse.json(await getHistoryImportStatus()));

/**
 * Subir el historial por partes y procesarlo.
 *
 * - `?upload=<id>&part=<n>` con el trozo en el cuerpo: guarda esa parte.
 * - `?upload=<id>&done=1&name=<archivo>`: junta las partes y procesa.
 */
export const POST = withStaff("owner", async ({ req, staff }) => {
  if (!isBlobConfigured()) return blobNotConfiguredResponse();
  const url = new URL(req.url);
  const uploadId = url.searchParams.get("upload") ?? "";
  if (!ID_RE.test(uploadId)) return apiError("invalid_upload", 400);

  if (url.searchParams.get("done") === "1") {
    const name = (url.searchParams.get("name") ?? "historial.json").slice(0, 120);
    fireAuditLog({
      staffUserId: staff.id,
      action: "IMPORT",
      entityType: "WhatsAppHistory",
      entityId: uploadId,
      changes: { file: name },
    });
    after(() => processHistoryUpload(uploadId, name));
    return NextResponse.json({ ok: true, status: "processing" });
  }

  const part = Number(url.searchParams.get("part"));
  if (!Number.isInteger(part) || part < 0 || part > 5000) return apiError("invalid_part", 400);
  const chunk = await req.arrayBuffer();
  if (chunk.byteLength === 0 || chunk.byteLength > MAX_PART) return apiError("invalid_part_size", 400);
  await saveHistoryPart(uploadId, part, chunk);
  return NextResponse.json({ ok: true });
});
