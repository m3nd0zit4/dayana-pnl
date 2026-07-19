import { NextRequest, NextResponse } from "next/server";
import { put } from "@vercel/blob";
import { resolveMember } from "@/lib/auth/api-member";
import { updateMemberAvatar } from "@/lib/crm/member-accounts";
import { blobNotConfiguredResponse, isBlobConfigured } from "@/lib/storage/blob";

export const dynamic = "force-dynamic";

const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED_MIMES = new Set(["image/jpeg", "image/png", "image/webp"]);

export const POST = async (req: NextRequest) => {
  const member = await resolveMember();
  if (member instanceof NextResponse) return member;

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

  const path = `contacts/${member.contact.id}/avatar/${Date.now()}.${mime === "image/png" ? "png" : mime === "image/webp" ? "webp" : "jpg"}`;

  try {
    const blob = await put(path, file, {
      access: "public",
      contentType: mime,
    });

    await updateMemberAvatar(member.contact.id, blob.url);

    return NextResponse.json({ avatarUrl: blob.url });
  } catch {
    return NextResponse.json({ error: "blob_upload_failed" }, { status: 500 });
  }
};
