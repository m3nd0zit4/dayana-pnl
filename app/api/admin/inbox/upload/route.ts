import { put } from "@vercel/blob";
import { NextResponse } from "next/server";
import { requireWriteStaff } from "@/lib/auth/api-staff";
import { isMetaInboxEnabled } from "@/lib/meta/client";
import { blobNotConfiguredResponse, isBlobConfigured } from "@/lib/storage/blob";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EXTENSION: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "video/mp4": "mp4",
  "audio/ogg": "ogg",
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
  "audio/aac": "aac",
  "application/pdf": "pdf",
};

/** Topes de WhatsApp Cloud API por tipo — el denominador común más estrecho
 * entre los tres canales, así que sirven igual para Messenger/Instagram. */
const MAX_BYTES: Record<string, number> = {
  "image/jpeg": 5 * 1024 * 1024,
  "image/png": 5 * 1024 * 1024,
  "image/webp": 5 * 1024 * 1024,
  "image/gif": 5 * 1024 * 1024,
  "video/mp4": 16 * 1024 * 1024,
  "audio/ogg": 16 * 1024 * 1024,
  "audio/mpeg": 16 * 1024 * 1024,
  "audio/mp4": 16 * 1024 * 1024,
  "audio/aac": 16 * 1024 * 1024,
  "application/pdf": 100 * 1024 * 1024,
};

/**
 * Sube un adjunto saliente a Blob para la bandeja de entrada.
 *
 * `access: "private"` — este store está configurado sin acceso público (ver
 * el mismo problema documentado en `AgentPanel.tsx` para los adjuntos del
 * agente), y de todos modos Meta nunca alcanzaría una URL nuestra. El envío
 * (`lib/meta/send.ts`) baja los bytes con el token del store y se los manda
 * a la Graph API directo (`/media` de WhatsApp, adjunto binario en
 * Messenger/Instagram) — nunca por `link`/`payload.url`.
 */
export const POST = async (req: Request) => {
  // La bandeja general puede estar apagada; la sección de WhatsApp también sube
  // adjuntos (fotos, documentos, notas de voz).
  const { isWhatsAppWorkspaceAvailable } = await import("@/lib/crm/whatsapp-agent/workspace");
  if (!isMetaInboxEnabled() && !(await isWhatsAppWorkspaceAvailable())) {
    return NextResponse.json({ error: "inbox_disabled" }, { status: 404 });
  }

  const staff = await requireWriteStaff();
  if (staff instanceof NextResponse) return staff;

  if (!isBlobConfigured()) return blobNotConfiguredResponse();

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "missing_file" }, { status: 400 });
  }
  // «audio/ogg; codecs=opus» (nota de voz grabada en el navegador) es audio/ogg.
  const mimeType = file.type.split(";")[0].trim().toLowerCase();
  const extension = EXTENSION[mimeType];
  if (!extension) {
    return NextResponse.json({ error: "unsupported_type" }, { status: 415 });
  }
  if (file.size > MAX_BYTES[mimeType]) {
    return NextResponse.json({ error: "file_too_large" }, { status: 413 });
  }

  try {
    const blob = await put(`inbox/outbound/${crypto.randomUUID()}.${extension}`, file, {
      access: "private",
      contentType: mimeType,
      addRandomSuffix: false,
    });

    return NextResponse.json({
      url: blob.url,
      mimeType,
      filename: file.name || `adjunto.${extension}`,
      size: file.size,
    });
  } catch (e) {
    console.error("[inbox upload]", e);
    return NextResponse.json({ error: "upload_failed" }, { status: 500 });
  }
};
