import { NextRequest, NextResponse } from "next/server";
import { getMemberSession } from "@/lib/auth/member-session";
import { deleteOwnComment, CommentValidationError } from "@/lib/lms/class-comments";

export const dynamic = "force-dynamic";

type RouteCtx = { params: Promise<{ id: string; commentId: string }> };

export async function DELETE(_req: NextRequest, ctx: RouteCtx) {
  const member = await getMemberSession();
  if (!member) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { commentId } = await ctx.params;

  try {
    await deleteOwnComment(commentId, member.contact.id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof CommentValidationError) {
      const status = e.code === "NOT_FOUND" ? 404 : 403;
      return NextResponse.json({ error: e.code }, { status });
    }
    throw e;
  }
}
