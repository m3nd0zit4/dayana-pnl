import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getMemberSession } from "@/lib/auth/member-session";
import { getEnrolledCourses } from "@/lib/lms/membership";
import { addComment, listCommentsForClass, CommentValidationError } from "@/lib/lms/class-comments";
import { notifyStaffOfNewComment } from "@/lib/notifications/staff-alert";
import { fireNotification } from "@/lib/notifications/platform/emit";

export const dynamic = "force-dynamic";

type RouteCtx = { params: Promise<{ id: string }> };

const requireCurrentMember = async (classId: string) => {
  const member = await getMemberSession();
  if (!member) {
    return { error: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };
  }

  const cls = await prisma.liveClassSession.findUnique({
    where: { id: classId },
    include: { module: true },
  });
  if (!cls || !cls.module?.isPublished) {
    return { error: NextResponse.json({ error: "not_found" }, { status: 404 }) };
  }

  const courses = await getEnrolledCourses(member.contact.id);
  const course = courses.find((c) => c.product.id === cls.productId);
  if (!course?.membership.isCurrent) {
    return {
      error: NextResponse.json({ error: "membership_inactive" }, { status: 403 }),
    };
  }

  return { contactId: member.contact.id, contactFirstName: member.contact.firstName, cls };
};

export async function GET(_req: NextRequest, ctx: RouteCtx) {
  const { id } = await ctx.params;
  const result = await requireCurrentMember(id);
  if ("error" in result) return result.error;

  const comments = await listCommentsForClass(id);
  return NextResponse.json({ comments });
}

export async function POST(req: NextRequest, ctx: RouteCtx) {
  const { id } = await ctx.params;
  const result = await requireCurrentMember(id);
  if ("error" in result) return result.error;

  const body = await req.json().catch(() => null);
  if (typeof body?.body !== "string") {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  try {
    const comment = await addComment(id, result.contactId, body.body);
    notifyStaffOfNewComment({
      classTitle: result.cls.title,
      contactName: result.contactFirstName,
      body: comment.body,
    }).catch((e) => console.error("[comments] staff notify failed", e));
    fireNotification({
      eventType: "LESSON_COMMENT_POSTED",
      title: `${result.contactFirstName} comentó en ${result.cls.title}`,
      body: comment.body.slice(0, 240),
      href: "/admin/curso/comentarios",
      entityType: "LiveClassSession",
      entityId: id,
      metadata: { commentId: comment.id, contactId: result.contactId },
      staff: "ALL",
    });
    return NextResponse.json({ comment });
  } catch (e) {
    if (e instanceof CommentValidationError) {
      return NextResponse.json({ error: e.code }, { status: 400 });
    }
    throw e;
  }
}
