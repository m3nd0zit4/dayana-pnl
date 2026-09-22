import { randomBytes } from "node:crypto";

import { put } from "@vercel/blob";
import { NextResponse } from "next/server";

import { requireWriteStaff } from "@/lib/auth/api-staff";
import { blobNotConfiguredResponse, isBlobConfigured } from "@/lib/storage/blob";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * El archivo que se entrega por una palabra clave (normalmente un PDF).
 *
 * Mismo camino que las portadas: el store de Blob es privado, así que se sube
 * privado y se sirve por `/api/media/material/<archivo>`. Así Dayana sube la
 * guía desde el CRM en vez de tener que alojarla en otro sitio y pegar un
 * enlace.
 */

/** Una guía en PDF. Más que esto es un video, y ese va por enlace. */
const MAX_BYTES = 25 * 1024 * 1024;

const EXTENSION: Record<string, string> = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
};

export const POST = async (req: Request) => {
  const staff = await requireWriteStaff();
  if (staff instanceof NextResponse) return staff;

  if (!isBlobConfigured()) return blobNotConfiguredResponse();

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "missing_file" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "file_too_large" }, { status: 413 });
  }

  const ext = EXTENSION[file.type];
  if (!ext) {
    return NextResponse.json({ error: "invalid_mime" }, { status: 415 });
  }

  const name = `${Date.now()}-${randomBytes(4).toString("hex")}.${ext}`;
  await put(`material/${name}`, file, {
    access: "private",
    contentType: file.type,
    addRandomSuffix: false,
  });

  return NextResponse.json({ url: `/api/media/material/${name}` });
};
