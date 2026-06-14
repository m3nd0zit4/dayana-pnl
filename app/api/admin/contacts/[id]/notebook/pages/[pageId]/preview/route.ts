import { NextRequest, NextResponse } from "next/server";
import { put } from "@vercel/blob";
import { requireWriteStaff } from "@/lib/auth/api-staff";
import { updateNotebookPage } from "@/lib/crm/contact-notebook";
import { canEditClinicalNotes } from "@/lib/crm/staff";
import { blobNotConfiguredResponse, isBlobConfigured } from "@/lib/storage/blob";

export const dynamic = "force-dynamic";

const MAX_BYTES = 5 * 1024 * 1024;

type RouteCtx = { params: Promise<{ id: string; pageId: string }> };

export async function POST(req: NextRequest, ctx: RouteCtx) {
  const staff = await requireWriteStaff();
  if (staff instanceof NextResponse) return staff;
  if (!canEditClinicalNotes(staff.role)) {
    return NextResponse.json({ error: "forbidden_notes" }, { status: 403 });
  }

  if (!isBlobConfigured()) {
    return blobNotConfiguredResponse();
  }

  const { id: contactId, pageId } = await ctx.params;
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "missing_file" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "file_too_large" }, { status: 400 });
  }
  if (file.type !== "image/png") {
    return NextResponse.json({ error: "invalid_mime" }, { status: 400 });
  }

  const path = `contacts/${contactId}/notebook/${pageId}/preview-${Date.now()}.png`;

  try {
    const blob = await put(path, file, {
      access: "public",
      contentType: "image/png",
    });

    const page = await updateNotebookPage(pageId, contactId, {
      previewUrl: blob.url,
    });

    if (!page) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }

    return NextResponse.json({ previewUrl: blob.url, page });
  } catch {
    return NextResponse.json({ error: "blob_upload_failed" }, { status: 500 });
  }
}
