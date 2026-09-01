import { put } from "@vercel/blob";
import { NextResponse } from "next/server";

import { requireWriteStaff } from "@/lib/auth/api-staff";
import { blobNotConfiguredResponse, isBlobConfigured } from "@/lib/storage/blob";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Portada de un producto: sube el archivo a Blob y devuelve su URL.
 *
 * Antes `imageUrl` era un campo de texto donde había que pegar una URL, lo que
 * en la práctica significaba subir la imagen a otro sitio primero. Aquí se
 * sube y ya.
 *
 * `access: "public"` porque la portada se sirve en la tarjeta pública: pasarla
 * por una ruta firmada sería pagar una función por cada imagen de catálogo.
 */

/** Una portada de tarjeta. Más de esto es una foto sin optimizar. */
const MAX_BYTES = 6 * 1024 * 1024;

const EXTENSION: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/avif": "avif",
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

  const blob = await put(`products/covers/${Date.now()}.${ext}`, file, {
    access: "public",
    contentType: file.type,
  });

  return NextResponse.json({ url: blob.url });
};
