import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getPortalViewer } from "@/lib/auth/portal-viewer";
import { getEnrolledCourses } from "@/lib/lms/membership";
import { isRecordingVisible } from "@/lib/lms/course-content";
import { getMuxClient, isMuxSigningConfigured, muxNotConfiguredResponse } from "@/lib/mux/client";

export const dynamic = "force-dynamic";

type RouteCtx = { params: Promise<{ id: string }> };

/** Signed playback tokens expire well before a 1-2h recorded class ends. */
const TOKEN_EXPIRATION = "4h";

export async function GET(_req: Request, ctx: RouteCtx) {
  if (!isMuxSigningConfigured()) return muxNotConfiguredResponse();

  const { id } = await ctx.params;

  const member = await getPortalViewer();
  if (!member) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const cls = await prisma.liveClassSession.findUnique({
    where: { id },
    include: { module: true },
  });
  if (!cls || !cls.module?.isPublished || !cls.muxPlaybackId) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const courses = await getEnrolledCourses(member.contact.id, {
    isOwner: member.isOwner,
  });
  const course = courses.find((c) => c.product.id === cls.productId);
  if (!course?.membership.isCurrent) {
    return NextResponse.json({ error: "membership_inactive" }, { status: 403 });
  }

  // A hidden/expired recording shouldn't hand out a fresh token just because
  // the membership itself is current — the 30-day retention window still
  // applies (Drive links never had an equivalent gap: this closes it).
  if (!isRecordingVisible(cls)) {
    return NextResponse.json({ error: "recording_hidden" }, { status: 403 });
  }

  const mux = getMuxClient();
  const token = await mux.jwt.signPlaybackId(cls.muxPlaybackId, {
    expiration: TOKEN_EXPIRATION,
  });

  return NextResponse.json({ token, playbackId: cls.muxPlaybackId });
}
