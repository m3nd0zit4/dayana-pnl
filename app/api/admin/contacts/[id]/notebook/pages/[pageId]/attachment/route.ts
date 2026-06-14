import { NextRequest, NextResponse } from "next/server";
import { getDownloadUrl } from "@vercel/blob";
import { resolveAdminStaff } from "@/lib/auth/api-staff";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

type RouteCtx = { params: Promise<{ id: string; pageId: string }> };

export async function GET(req: NextRequest, ctx: RouteCtx) {
  const staff = await resolveAdminStaff();
  if (staff instanceof NextResponse) return staff;

  const { id: contactId, pageId } = await ctx.params;
  const type = req.nextUrl.searchParams.get("type") ?? "attachment";

  const page = await prisma.contactNotebookPage.findFirst({
    where: { id: pageId, contactId },
    select: {
      attachmentUrl: true,
      attachmentMime: true,
      attachmentName: true,
      previewUrl: true,
    },
  });

  if (!page) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const url = type === "preview" ? page.previewUrl : page.attachmentUrl;
  if (!url) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  return NextResponse.json({
    url: getDownloadUrl(url),
    mime: type === "preview" ? "image/png" : page.attachmentMime,
    name: type === "preview" ? "preview.png" : page.attachmentName,
  });
}
