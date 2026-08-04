import { NextRequest, NextResponse } from "next/server";
import { put } from "@vercel/blob";
import { requireWriteStaff } from "@/lib/auth/api-staff";
import { fireAuditLog } from "@/lib/crm/audit";
import { blobNotConfiguredResponse, isBlobConfigured } from "@/lib/storage/blob";
import { clearClassMaterial, uploadClassMaterial } from "@/lib/lms/course-admin";

export const dynamic = "force-dynamic";

const MAX_BYTES = 25 * 1024 * 1024;

type RouteParams = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: RouteParams) {
  const staff = await requireWriteStaff();
  if (staff instanceof NextResponse) return staff;
  if (!isBlobConfigured()) return blobNotConfiguredResponse();

  const { id } = await params;

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "missing_file" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "file_too_large" }, { status: 400 });
  }
  if ((file.type || "") !== "application/pdf") {
    return NextResponse.json({ error: "invalid_mime" }, { status: 400 });
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
    return NextResponse.json({ error: "blob_upload_failed" }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: RouteParams) {
  const staff = await requireWriteStaff();
  if (staff instanceof NextResponse) return staff;

  const { id } = await params;
  const liveClass = await clearClassMaterial(id).catch(() => null);
  if (!liveClass) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  fireAuditLog({
    staffUserId: staff.id,
    action: "UPDATE",
    entityType: "LiveClassSession",
    entityId: id,
    changes: { material: "cleared" },
  });

  return NextResponse.json({ ok: true });
}
