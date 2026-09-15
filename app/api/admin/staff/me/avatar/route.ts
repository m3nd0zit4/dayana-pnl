import { NextResponse } from "next/server";
import { put } from "@vercel/blob";
import { apiError, withStaff } from "@/lib/api/handler";
import { updateStaffAvatar } from "@/lib/crm/staff";
import { blobNotConfiguredResponse, isBlobConfigured } from "@/lib/storage/blob";

export const dynamic = "force-dynamic";

const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED_MIMES = new Set(["image/jpeg", "image/png", "image/webp"]);

export const POST = withStaff("read", async ({ req, staff }) => {
  if (!isBlobConfigured()) {
    return blobNotConfiguredResponse();
  }

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");

  if (!(file instanceof File)) {
    return apiError("missing_file", 400);
  }
  if (file.size > MAX_BYTES) {
    return apiError("file_too_large", 400);
  }

  const mime = file.type || "application/octet-stream";
  if (!ALLOWED_MIMES.has(mime)) {
    return apiError("invalid_mime", 400);
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
    return apiError("blob_upload_failed", 500);
  }
});
