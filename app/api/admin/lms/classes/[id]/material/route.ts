import { NextResponse } from "next/server";
import { put } from "@vercel/blob";
import { apiError, withStaff } from "@/lib/api/handler";
import { fireAuditLog } from "@/lib/crm/audit";
import { blobNotConfiguredResponse, isBlobConfigured } from "@/lib/storage/blob";
import { clearClassMaterial, uploadClassMaterial } from "@/lib/lms/course-admin";

export const dynamic = "force-dynamic";

const MAX_BYTES = 25 * 1024 * 1024;

type Params = { id: string };

export const POST = withStaff<Params>("write", async ({ req, staff, params }) => {
  if (!isBlobConfigured()) return blobNotConfiguredResponse();

  const { id } = params;

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) {
    return apiError("missing_file", 400);
  }
  if (file.size > MAX_BYTES) {
    return apiError("file_too_large", 400);
  }
  if ((file.type || "") !== "application/pdf") {
    return apiError("invalid_mime", 400);
  }

  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 150);
  const path = `lms/classes/${id}/material/${Date.now()}-${safeName}`;

  try {
    const blob = await put(path, file, { access: "private", contentType: "application/pdf" });
    const liveClass = await uploadClassMaterial(id, {
      url: blob.url,
      filename: file.name,
      sizeBytes: file.size,
    });

    fireAuditLog({
      staffUserId: staff.id,
      action: "UPDATE",
      entityType: "LiveClassSession",
      entityId: id,
      changes: { material: file.name },
    });

    return NextResponse.json({ liveClass });
  } catch (err) {
    console.error("class material upload failed", err);
    return apiError("blob_upload_failed", 500);
  }
});

export const DELETE = withStaff<Params>("write", async ({ staff, params }) => {
  const { id } = params;
  const liveClass = await clearClassMaterial(id).catch(() => null);
  if (!liveClass) {
    return apiError("not_found", 404);
  }

  fireAuditLog({
    staffUserId: staff.id,
    action: "UPDATE",
    entityType: "LiveClassSession",
    entityId: id,
    changes: { material: "cleared" },
  });

  return NextResponse.json({ ok: true });
});
