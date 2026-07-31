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
  "application/pdf": 100 * 1024 * 1024,
};

/**
 * Sube un adjunto saliente a Blob para la bandeja de entrada.
 *
 * Igual que `rehostAttachment` en el sentido inverso: Meta pide un `link`
 * público para mandar medios (WhatsApp) o un `payload.url` (Messenger/
 * Instagram), así que el archivo tiene que vivir en una URL alcanzable antes
 * de llamar a la Graph API — no hay forma de mandar los bytes inline.
 */
export const POST = async (req: Request) => {
  if (!isMetaInboxEnabled()) {
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
  const extension = EXTENSION[file.type];
  if (!extension) {
    return NextResponse.json({ error: "unsupported_type" }, { status: 415 });
  }
  if (file.size > MAX_BYTES[file.type]) {
    return NextResponse.json({ error: "file_too_large" }, { status: 413 });
  }

  try {
    const blob = await put(`inbox/outbound/${crypto.randomUUID()}.${extension}`, file, {
      access: "public",
      contentType: file.type,
      addRandomSuffix: false,
    });

    return NextResponse.json({
      url: blob.url,
      mimeType: file.type,
      filename: file.name || `adjunto.${extension}`,
      size: file.size,
    });
  } catch (e) {
    console.error("[inbox upload]", e);
    return NextResponse.json({ error: "upload_failed" }, { status: 500 });
  }
};
