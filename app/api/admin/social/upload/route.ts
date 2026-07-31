import { put } from "@vercel/blob";
import { NextResponse } from "next/server";
import { requireWriteStaff } from "@/lib/auth/api-staff";
import { blobNotConfiguredResponse, isBlobConfigured } from "@/lib/storage/blob";
import { resolveSocialPublishingEnabled } from "@/lib/tiktok/resolve-flags";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** TikTok admite hasta 4 GB, pero una función no debe tragarse eso. */
const MAX_BYTES = 300 * 1024 * 1024;

const ALLOWED = new Set([
  "video/mp4",
  "video/quicktime",
  "video/webm",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

const EXTENSION: Record<string, string> = {
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/webm": "webm",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

/**
 * Sube el archivo a Blob y devuelve su URL.
 *
 * El publicador descarga de aquí y empuja los bytes a TikTok (FILE_UPLOAD), así
 * que no hace falta que TikTok pueda alcanzar este dominio ni verificarlo.
 */
export const POST = async (req: Request) => {
  if (!(await resolveSocialPublishingEnabled())) {
    return NextResponse.json({ error: "tiktok_disabled" }, { status: 404 });
  }

  const staff = await requireWriteStaff();
  if (staff instanceof NextResponse) return staff;

  if (!isBlobConfigured()) return blobNotConfiguredResponse();

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "missing_file" }, { status: 400 });
  }
  if (!ALLOWED.has(file.type)) {
    return NextResponse.json({ error: "unsupported_type" }, { status: 415 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "file_too_large" }, { status: 413 });
  }

  try {
    const blob = await put(
      `social/${crypto.randomUUID()}.${EXTENSION[file.type] ?? "bin"}`,
      file,
      { access: "public", contentType: file.type, addRandomSuffix: false }
    );

    return NextResponse.json({
      url: blob.url,
      mediaType: file.type.startsWith("video/") ? "VIDEO" : "PHOTO",
      size: file.size,
    });
  } catch (e) {
    console.error("[social upload]", e);
    return NextResponse.json({ error: "upload_failed" }, { status: 500 });
  }
};
