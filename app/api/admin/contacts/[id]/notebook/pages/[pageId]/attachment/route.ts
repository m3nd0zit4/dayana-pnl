import { NextRequest, NextResponse } from "next/server";
import { get } from "@vercel/blob";
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

  const blobUrl = type === "preview" ? page.previewUrl : page.attachmentUrl;
  if (!blobUrl) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const access = blobUrl.includes(".private.blob.vercel-storage.com")
    ? "private"
    : "public";

  const result = await get(blobUrl, { access });
  if (!result?.stream) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const contentType =
    type === "preview"
      ? "image/png"
      : (page.attachmentMime ?? result.blob.contentType);

  const filename =
    type === "preview" ? "preview.png" : (page.attachmentName ?? "attachment");

  return new NextResponse(result.stream, {
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": `inline; filename="${filename.replace(/"/g, "")}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
