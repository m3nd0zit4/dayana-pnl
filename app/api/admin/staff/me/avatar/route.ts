import { NextRequest, NextResponse } from "next/server";
import { put } from "@vercel/blob";
import { resolveAdminStaff } from "@/lib/auth/api-staff";
import { updateStaffAvatar } from "@/lib/crm/staff";
import { blobNotConfiguredResponse, isBlobConfigured } from "@/lib/storage/blob";

export const dynamic = "force-dynamic";

const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED_MIMES = new Set(["image/jpeg", "image/png", "image/webp"]);

export const POST = async (req: NextRequest) => {
  const staff = await resolveAdminStaff();
  if (staff instanceof NextResponse) return staff;

  if (!isBlobConfigured()) {
    return blobNotConfiguredResponse();
  }

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "missing_file" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "file_too_large" }, { status: 400 });
  }

  const mime = file.type || "application/octet-stream";
  if (!ALLOWED_MIMES.has(mime)) {
    return NextResponse.json({ error: "invalid_mime" }, { status: 400 });
  }

  const path = `staff/${staff.id}/avatar/${Date.now()}.${mime === "image/png" ? "png" : mime === "image/webp" ? "webp" : "jpg"}`;

  try {
    const blob = await put(path, file, {
      access: "public",
      contentType: mime,
    });

    await updateStaffAvatar(staff.id, blob.url);

    return NextResponse.json({ avatarUrl: blob.url });
  } catch {
    return NextResponse.json({ error: "blob_upload_failed" }, { status: 500 });
  }
};
