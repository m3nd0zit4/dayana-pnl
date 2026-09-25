import { NextResponse } from "next/server";
import { z } from "zod";

import { apiError, readJson, withStaff } from "@/lib/api/handler";
import { fireAuditLog } from "@/lib/crm/audit";
import {
  ExportImportError,
  exportTextsFromUpload,
  importExportChat,
  previewExportFiles,
} from "@/lib/crm/whatsapp-export-import";

export const dynamic = "force-dynamic";
// Un chat de años son miles de mensajes, y al final se aprende de ellos.
export const maxDuration = 300;

/** El límite de un pedido en Vercel es ~4,5 MB. */
const MAX_REQUEST_BYTES = 4 * 1024 * 1024;
const MAX_TEXT_CHARS = 3_500_000;

const importSchema = z.object({
  action: z.literal("import"),
  fileName: z.string().trim().min(1).max(200),
  text: z.string().min(1).max(MAX_TEXT_CHARS),
  phoneE164: z.string().trim().min(6).max(32),
  dayanaAuthor: z.string().trim().max(120).nullable(),
});

const ERROR_STATUS: Record<ExportImportError["code"], number> = {
  invalid_phone: 400,
  no_messages: 422,
  group_chat: 422,
};

/**
 * Chats exportados desde el celular («Exportar chat» → «Sin archivos»).
 *
 * - multipart con `action=preview` y uno o varios `files` (.txt o .zip):
 *   devuelve, por chat, el contacto, el número, con quién podría ser, quién
 *   escribe y cuántos mensajes trae. No guarda nada.
 * - JSON `{ action: "import", fileName, text, phoneE164, dayanaAuthor }`: un
 *   chat por pedido. Guarda los mensajes como historial (idempotente).
 */
export const POST = withStaff("owner", async ({ req, staff }) => {
  const length = Number(req.headers.get("content-length") ?? 0);
  if (length > MAX_REQUEST_BYTES) return apiError("too_large", 413);

  const contentType = req.headers.get("content-type") ?? "";
  if (contentType.includes("multipart/form-data")) {
    const form = await req.formData().catch(() => null);
    if (!form || form.get("action") !== "preview") return apiError("invalid_request", 400);
    const uploads = form.getAll("files").filter((f): f is File => typeof f !== "string");
    if (uploads.length === 0) return apiError("no_files", 400);
    const texts = [];
    for (const upload of uploads) {
      try {
        texts.push(...exportTextsFromUpload(upload.name, new Uint8Array(await upload.arrayBuffer())));
      } catch {
        return apiError("unreadable_file", 422, { fileName: upload.name });
      }
    }
    const files = await previewExportFiles(texts);
    return NextResponse.json({ files });
  }

  const parsed = importSchema.safeParse(await readJson(req));
  if (!parsed.success) return apiError("invalid_request", 400);
  const { fileName, text, phoneE164, dayanaAuthor } = parsed.data;
  try {
    const result = await importExportChat({ fileName, text, phoneE164, dayanaAuthor });
    fireAuditLog({
      staffUserId: staff.id,
      action: "IMPORT",
      entityType: "WhatsAppHistory",
      entityId: result.conversationId ?? result.threadId,
      changes: { file: fileName.slice(0, 120), source: "phone_export", stored: result.stored },
    });
    return NextResponse.json(result);
  } catch (e) {
    if (e instanceof ExportImportError) return apiError(e.code, ERROR_STATUS[e.code]);
    throw e;
  }
});
