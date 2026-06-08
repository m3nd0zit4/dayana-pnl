import { NextRequest, NextResponse } from "next/server";
import { put } from "@vercel/blob";
import { requireWriteStaff } from "@/lib/auth/api-staff";
import { canEditClinicalNotes } from "@/lib/crm/staff";

export const dynamic = "force-dynamic";

const MAX_BYTES = 15 * 1024 * 1024;
const ALLOWED_MIMES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
]);

type RouteCtx = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, ctx: RouteCtx) {
  const staff = await requireWriteStaff();
  if (staff instanceof NextResponse) return staff;
  if (!canEditClinicalNotes(staff.role)) {
    return NextResponse.json({ error: "forbidden_notes" }, { status: 403 });
  }

  const { id: contactId } = await ctx.params;
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

  if (!process.env.BLOB_READ_WRITE_TOKEN?.trim()) {
    return NextResponse.json({ error: "blob_not_configured" }, { status: 503 });
  }

  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120);
  const path = `contacts/${contactId}/notes/${Date.now()}-${safeName}`;

  try {
    const blob = await put(path, file, {
      access: "public",
      contentType: mime,
    });

    return NextResponse.json({
      attachmentUrl: blob.url,
      attachmentMime: mime,
      attachmentName: file.name,
    });
  } catch {
    return NextResponse.json({ error: "blob_upload_failed" }, { status: 502 });
  }
}
