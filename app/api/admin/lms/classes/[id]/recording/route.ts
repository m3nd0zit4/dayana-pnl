import { NextRequest, NextResponse } from "next/server";
import { requireWriteStaff } from "@/lib/auth/api-staff";
import { fireAuditLog } from "@/lib/crm/audit";
import { isMuxConfigured, muxNotConfiguredResponse } from "@/lib/mux/client";
import { clearRecording, createRecordingUpload } from "@/lib/lms/course-admin";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ id: string }> };

export async function POST(_req: NextRequest, { params }: RouteParams) {
  const staff = await requireWriteStaff();
  if (staff instanceof NextResponse) return staff;
  if (!isMuxConfigured()) return muxNotConfiguredResponse();

  const { id } = await params;
  const { uploadUrl, uploadId } = await createRecordingUpload(id).catch(
    () => ({ uploadUrl: null, uploadId: null })
  );
  if (!uploadUrl || !uploadId) {
    return NextResponse.json({ error: "upload_failed" }, { status: 502 });
  }

  fireAuditLog({
    staffUserId: staff.id,
    action: "CREATE",
    entityType: "LiveClassSession",
    entityId: id,
    changes: { recording: "mux_upload_started" },
  });

  return NextResponse.json({ uploadUrl, uploadId });
}

export async function DELETE(_req: NextRequest, { params }: RouteParams) {
  const staff = await requireWriteStaff();
  if (staff instanceof NextResponse) return staff;

  const { id } = await params;
  const cleared = await clearRecording(id).catch(() => null);
  if (!cleared) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  fireAuditLog({
    staffUserId: staff.id,
    action: "DELETE",
    entityType: "LiveClassSession",
    entityId: id,
    changes: { recording: "cleared" },
  });

  return NextResponse.json({ ok: true });
}
