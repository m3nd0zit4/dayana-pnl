import { NextResponse } from "next/server";
import { get } from "@vercel/blob";
import { prisma } from "@/lib/db";
import { getPortalViewer } from "@/lib/auth/portal-viewer";
import { getEnrolledCourses } from "@/lib/lms/membership";

export const dynamic = "force-dynamic";

type RouteCtx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: RouteCtx) {
  const { id } = await ctx.params;

  const member = await getPortalViewer();
  if (!member) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const cls = await prisma.liveClassSession.findUnique({
    where: { id },
    include: { module: true },
  });
  if (!cls || !cls.module?.isPublished || !cls.materialUrl) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const courses = await getEnrolledCourses(member.contact.id, {
    isOwner: member.isOwner,
  });
  const course = courses.find((c) => c.product.id === cls.productId);
  if (!course?.membership.isCurrent) {
    return NextResponse.json({ error: "membership_inactive" }, { status: 403 });
  }

  const result = await get(cls.materialUrl, { access: "private" });
  if (!result || result.statusCode !== 200 || !result.stream) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  return new NextResponse(result.stream, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${(cls.materialFileName ?? "material.pdf").replace(/"/g, "")}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
