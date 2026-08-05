import { put } from "@vercel/blob";
import { NextResponse } from "next/server";
import { requireWriteStaff } from "@/lib/auth/api-staff";
import { fireAuditLog } from "@/lib/crm/audit";
import { ensureFreeWebinar, updateFreeWebinar } from "@/lib/crm/free-webinar";
import { blobNotConfiguredResponse, isBlobConfigured } from "@/lib/storage/blob";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 200 * 1024 * 1024;

const ALLOWED = new Set([
  "video/mp4",
  "video/quicktime",
  "video/webm",
]);

const EXTENSION: Record<string, string> = {
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/webm": "webm",
};

/** Upload promo video for the free webinar landing → Vercel Blob, save URL. */
export const POST = async (req: Request) => {
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
      `webinar/${crypto.randomUUID()}.${EXTENSION[file.type] ?? "mp4"}`,
      file,
      { access: "public", contentType: file.type, addRandomSuffix: false }
    );

    const webinar = await updateFreeWebinar({ videoUrl: blob.url });

    fireAuditLog({
      staffUserId: staff.id,
      action: "UPDATE",
      entityType: "FreeWebinar",
      entityId: webinar.id,
      changes: { videoUrl: blob.url },
    });

    return NextResponse.json({
      url: blob.url,
      webinar,
    });
  } catch (e) {
    console.error("[webinar video upload]", e);
    return NextResponse.json({ error: "upload_failed" }, { status: 500 });
  }
};

/** Remove video from the landing (does not delete the blob object). */
export const DELETE = async () => {
  const staff = await requireWriteStaff();
  if (staff instanceof NextResponse) return staff;

  await ensureFreeWebinar();
  const webinar = await updateFreeWebinar({ videoUrl: null });

  fireAuditLog({
    staffUserId: staff.id,
    action: "UPDATE",
    entityType: "FreeWebinar",
    entityId: webinar.id,
    changes: { videoUrl: null },
  });

  return NextResponse.json({ webinar });
};
