import { NextResponse } from "next/server";

import { apiError, withStaff } from "@/lib/api/handler";
import { MetaApiError } from "@/lib/meta/client";
import { uploadWhatsAppMedia } from "@/lib/meta/send";
import { resolveWhatsAppCredentials } from "@/lib/meta/whatsapp-provider";
import { resolveDryRun } from "@/lib/notifications/platform/resolve";
import { isBlobConfigured } from "@/lib/storage/blob";
import { putOutboundMedia } from "@/lib/storage/outbound-media";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** WhatsApp: imágenes JPG o PNG de hasta 5 MB (cabecera de plantilla e imagen suelta). */
const MAX_BYTES = 5 * 1024 * 1024;

/** El tipo real por los primeros bytes: la extensión o el `type` del navegador pueden mentir. */
const sniffImageType = (bytes: Uint8Array): "image/png" | "image/jpeg" | null => {
  if (bytes.length >= 4 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return "image/png";
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  return null;
};

/**
 * La copia para el chat del CRM, guardada como los adjuntos de la bandeja:
 * sin ella cada mensaje del envío se ve solo con el texto. Si falla, el envío
 * sigue igual (la imagen les llega por el id de WhatsApp) y el chat muestra
 * el aviso de «📷 Foto».
 */
const storeChatCopy = async (
  buffer: ArrayBuffer,
  mimeType: "image/png" | "image/jpeg"
): Promise<{ url: string; mimeType: string } | null> => {
  if (!isBlobConfigured()) return null;
  try {
    const url = await putOutboundMedia(buffer, mimeType, mimeType === "image/png" ? "png" : "jpg");
    return { url, mimeType };
  } catch (e) {
    console.warn("[whatsapp-sends/image] no se pudo guardar la copia para el chat", e);
    return null;
  }
};

/**
 * Sube UNA vez la imagen de un envío masivo a los medios de WhatsApp y
 * devuelve su id. El envío lo guarda en `vars` y cada persona lo reutiliza
 * (cabecera de la plantilla o imagen con pie): 159 personas no son 159 subidas.
 * En modo prueba no sale nada: devuelve un id de mentira.
 * `copy`: la misma imagen en Blob, para que el chat la muestre.
 */
export const POST = withStaff("write", async ({ req }) => {
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) {
    return apiError("missing_file", 400, { message: "No llegó la imagen." });
  }
  if (file.size > MAX_BYTES) {
    return apiError("file_too_large", 413, { message: "La imagen pesa más de 5 MB (el tope de WhatsApp)." });
  }
  const buffer = await file.arrayBuffer();
  const mimeType = sniffImageType(new Uint8Array(buffer));
  if (!mimeType) {
    return apiError("unsupported_type", 415, { message: "La imagen debe ser JPG o PNG." });
  }

  if (await resolveDryRun()) {
    return NextResponse.json({
      id: `dryrun-${crypto.randomUUID()}`,
      dryRun: true,
      copy: await storeChatCopy(buffer, mimeType),
    });
  }

  const credentials = await resolveWhatsAppCredentials();
  if (!credentials) {
    return apiError("whatsapp_not_configured", 400, {
      message: "WhatsApp no está configurado: elige el proveedor y su clave en Ajustes → Canales.",
    });
  }
  try {
    const id = await uploadWhatsAppMedia(buffer, mimeType, credentials);
    return NextResponse.json({ id, dryRun: false, copy: await storeChatCopy(buffer, mimeType) });
  } catch (e) {
    const detail =
      e instanceof MetaApiError ? `${e.message}${e.code ? ` (código ${e.code})` : ""}` : e instanceof Error ? e.message : "";
    console.error("[whatsapp-sends/image]", detail);
    return apiError("upload_failed", 502, {
      message: `WhatsApp no aceptó la imagen${detail ? `: ${detail}` : "."}`,
    });
  }
});
