import { NextRequest, NextResponse } from "next/server";
import { requireWriteStaff } from "@/lib/auth/api-staff";
import { fireAuditLog } from "@/lib/crm/audit";
import { deleteCommentAsStaff } from "@/lib/lms/class-comments";

export const dynamic = "force-dynamic";

type RouteCtx = { params: Promise<{ id: string; commentId: string }> };

export async function DELETE(_req: NextRequest, ctx: RouteCtx) {
  const staff = await requireWriteStaff();
  if (staff instanceof NextResponse) return staff;

  const { commentId } = await ctx.params;
  await deleteCommentAsStaff(commentId);

  fireAuditLog({
    staffUserId: staff.id,
    action: "DELETE",
    entityType: "LessonComment",
    entityId: commentId,
  });

  return NextResponse.json({ ok: true });
}
