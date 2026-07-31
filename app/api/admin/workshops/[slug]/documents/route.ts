import { NextRequest, NextResponse } from "next/server";
import { put } from "@vercel/blob";
import { requireWriteStaff, resolveAdminStaff } from "@/lib/auth/api-staff";
import { fireAuditLog } from "@/lib/crm/audit";
import { createWorkshopDocument, listWorkshopDocuments } from "@/lib/crm/workshop-editions";
import { prisma } from "@/lib/db";
import { blobNotConfiguredResponse, isBlobConfigured } from "@/lib/storage/blob";

export const dynamic = "force-dynamic";

const MAX_BYTES = 25 * 1024 * 1024;
const ALLOWED_MIMES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);

type Ctx = { params: Promise<{ slug: string }> };

export async function GET(_req: NextRequest, ctx: Ctx) {
  const staff = await resolveAdminStaff();
  if (staff instanceof NextResponse) return staff;

  const { slug } = await ctx.params;
  const edition = await prisma.workshopEdition.findUnique({
    where: { slug },
    select: { id: true },
  });
  if (!edition) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const documents = await listWorkshopDocuments(edition.id);
  return NextResponse.json({ documents });
}

export async function POST(req: NextRequest, ctx: Ctx) {
  const staff = await requireWriteStaff();
  if (staff instanceof NextResponse) return staff;
  if (!isBlobConfigured()) return blobNotConfiguredResponse();

  const { slug } = await ctx.params;
  const edition = await prisma.workshopEdition.findUnique({
    where: { slug },
    select: { id: true },
  });
  if (!edition) return NextResponse.json({ error: "not_found" }, { status: 404 });

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

  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 150);
  const path = `workshops/${edition.id}/documents/${Date.now()}-${safeName}`;

  try {
    const blob = await put(path, file, { access: "private", contentType: mime });

    const document = await createWorkshopDocument({
      workshopEditionId: edition.id,
      url: blob.url,
      filename: file.name,
      mimeType: mime,
      sizeBytes: file.size,
    });

    fireAuditLog({
      staffUserId: staff.id,
      action: "CREATE",
      entityType: "WorkshopDocument",
      entityId: document.id,
      changes: { workshopEditionId: edition.id, filename: file.name },
    });

    return NextResponse.json({ document });
  } catch {
    return NextResponse.json({ error: "blob_upload_failed" }, { status: 500 });
  }
}
