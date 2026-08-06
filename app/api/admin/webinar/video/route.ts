import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { NextResponse } from "next/server";
import { requireWriteStaff } from "@/lib/auth/api-staff";
import { fireAuditLog } from "@/lib/crm/audit";
import { ensureFreeWebinar, updateFreeWebinar } from "@/lib/crm/free-webinar";
import { blobNotConfiguredResponse, isBlobConfigured } from "@/lib/storage/blob";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Promo videos can be large; server FormData uploads die at Vercel's ~4.5 MB body limit. */
const MAX_BYTES = 200 * 1024 * 1024;

const ALLOWED_CONTENT_TYPES = [
  "video/mp4",
  "video/quicktime",
  "video/webm",
] as const;

/**
 * Client-upload token exchange for the free-webinar promo video.
 *
 * Browser → Blob directly (via `@vercel/blob/client` `upload`), so size is not
 * capped by the serverless request body. The store is private-only — client
 * must use `access: "private"`. Public landing plays via `/api/webinar/video`.
 *
 * The admin UI then PATCHes `/api/admin/webinar` with the returned URL (and
 * `onUploadCompleted` does the same when Vercel can reach this host).
 */
export const POST = async (req: Request) => {
  const staff = await requireWriteStaff();
  if (staff instanceof NextResponse) return staff;

  if (!isBlobConfigured()) return blobNotConfiguredResponse();

  const body = (await req.json().catch(() => null)) as HandleUploadBody | null;
  if (!body) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  try {
    const jsonResponse = await handleUpload({
      body,
      request: req,
      onBeforeGenerateToken: async (pathname) => {
        if (!pathname.startsWith("webinar/")) {
          throw new Error("invalid_pathname");
        }
        return {
          allowedContentTypes: [...ALLOWED_CONTENT_TYPES],
          maximumSizeInBytes: MAX_BYTES,
          addRandomSuffix: false,
          tokenPayload: JSON.stringify({ staffUserId: staff.id }),
        };
      },
      onUploadCompleted: async ({ blob, tokenPayload }) => {
        // Fires on Vercel when Blob can callback. Locally this often never
        // runs — the client always PATCHes videoUrl as the source of truth.
        const webinar = await updateFreeWebinar({ videoUrl: blob.url });
        let staffUserId: string | undefined;
        try {
          staffUserId = (
            JSON.parse(tokenPayload ?? "{}") as { staffUserId?: string }
          ).staffUserId;
        } catch {
          staffUserId = undefined;
        }
        if (staffUserId) {
          fireAuditLog({
            staffUserId,
            action: "UPDATE",
            entityType: "FreeWebinar",
            entityId: webinar.id,
            changes: { videoUrl: blob.url, via: "blob_callback" },
          });
        }
      },
    });

    return NextResponse.json(jsonResponse);
  } catch (e) {
    console.error("[webinar video upload]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "upload_failed" },
      { status: 400 }
    );
  }
};

/** Remove video from the landing (does not delete the blob object). */
export const DELETE = async () => {
  const staff = await requireWriteStaff();
  if (staff instanceof NextResponse) return staff;

  await ensureFreeWebinar();
  const webinar = await updateFreeWebinar({ videoUrl: null });

  fireAuditLog({
    staffUserId: staff.id,
    action: "UPDATE",
    entityType: "FreeWebinar",
    entityId: webinar.id,
    changes: { videoUrl: null },
  });

  return NextResponse.json({ webinar });
};
