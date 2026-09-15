import { NextResponse } from "next/server";
import { put } from "@vercel/blob";
import { apiError, withStaff } from "@/lib/api/handler";
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

type Params = { slug: string };

export const GET = withStaff<Params>("read", async ({ params }) => {
  const { slug } = params;
  const edition = await prisma.workshopEdition.findUnique({
    where: { slug },
    select: { id: true },
  });
  if (!edition) return apiError("not_found", 404);

  const documents = await listWorkshopDocuments(edition.id);
  return NextResponse.json({ documents });
});

export const POST = withStaff<Params>("write", async ({ req, staff, params }) => {
  if (!isBlobConfigured()) return blobNotConfiguredResponse();

  const { slug } = params;
  const edition = await prisma.workshopEdition.findUnique({
    where: { slug },
    select: { id: true },
  });
  if (!edition) return apiError("not_found", 404);

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
  } catch (err) {
    console.error("workshop document upload failed", err);
    return apiError("blob_upload_failed", 500);
  }
});
