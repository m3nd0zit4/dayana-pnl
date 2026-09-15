import { NextResponse } from "next/server";
import { apiError, withStaff } from "@/lib/api/handler";
import { fireAuditLog } from "@/lib/crm/audit";
import { isMuxConfigured } from "@/lib/mux/client";
import { muxNotConfiguredResponse } from "@/lib/mux/http";
import { clearRecording, createRecordingUpload } from "@/lib/lms/course-admin";

export const dynamic = "force-dynamic";

type Params = { id: string };

export const POST = withStaff<Params>("write", async ({ staff, params }) => {
  if (!isMuxConfigured()) return muxNotConfiguredResponse();

  const { id } = params;
  const { uploadUrl, uploadId } = await createRecordingUpload(id).catch(
    () => ({ uploadUrl: null, uploadId: null })
  );
  if (!uploadUrl || !uploadId) {
    return apiError("upload_failed", 502);
  }

  fireAuditLog({
    staffUserId: staff.id,
    action: "CREATE",
    entityType: "LiveClassSession",
    entityId: id,
    changes: { recording: "mux_upload_started" },
  });

  return NextResponse.json({ uploadUrl, uploadId });
});

export const DELETE = withStaff<Params>("write", async ({ staff, params }) => {
  const { id } = params;
  const cleared = await clearRecording(id).catch(() => null);
  if (!cleared) {
    return apiError("not_found", 404);
  }

  fireAuditLog({
    staffUserId: staff.id,
    action: "DELETE",
    entityType: "LiveClassSession",
    entityId: id,
    changes: { recording: "cleared" },
  });

  return NextResponse.json({ ok: true });
});
