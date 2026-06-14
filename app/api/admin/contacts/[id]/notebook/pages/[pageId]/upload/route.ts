import { NextRequest, NextResponse } from "next/server";
import { put } from "@vercel/blob";
import { NotebookPageKind } from "@prisma/client";
import { requireWriteStaff } from "@/lib/auth/api-staff";
import { fireAuditLog } from "@/lib/crm/audit";
import { updateNotebookPage } from "@/lib/crm/contact-notebook";
import { canEditClinicalNotes } from "@/lib/crm/staff";
import { blobNotConfiguredResponse, isBlobConfigured } from "@/lib/storage/blob";

export const dynamic = "force-dynamic";

const MAX_BYTES = 15 * 1024 * 1024;
const ALLOWED_MIMES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
]);

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

  const mime = file.type || "application/octet-stream";
  if (!ALLOWED_MIMES.has(mime)) {
    return NextResponse.json({ error: "invalid_mime" }, { status: 400 });
  }

  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120);
  const path = `contacts/${contactId}/notebook/${pageId}/${Date.now()}-${safeName}`;

  try {
    const blob = await put(path, file, {
      access: "public",
      contentType: mime,
    });

    const page = await updateNotebookPage(pageId, contactId, {
      kind: NotebookPageKind.UPLOAD,
      attachmentUrl: blob.url,
      attachmentMime: mime,
      attachmentName: file.name,
    });

    if (!page) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }

    fireAuditLog({
      staffUserId: staff.id,
      action: "UPDATE",
      entityType: "ContactNotebookPage",
      entityId: pageId,
      changes: { upload: true },
    });

    return NextResponse.json({
      attachmentUrl: blob.url,
      attachmentMime: mime,
      attachmentName: file.name,
      page,
    });
  } catch {
    return NextResponse.json({ error: "blob_upload_failed" }, { status: 500 });
  }
}
