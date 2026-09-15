import { NextResponse } from "next/server";
import { withStaff } from "@/lib/api/handler";
import { fireAuditLog } from "@/lib/crm/audit";
import { deleteCommentAsStaff } from "@/lib/lms/class-comments";

export const dynamic = "force-dynamic";

type Params = { id: string; commentId: string };

export const DELETE = withStaff<Params>("write", async ({ staff, params }) => {
  const { commentId } = params;
  await deleteCommentAsStaff(commentId);

  fireAuditLog({
    staffUserId: staff.id,
    action: "DELETE",
    entityType: "LessonComment",
    entityId: commentId,
  });

  return NextResponse.json({ ok: true });
});
