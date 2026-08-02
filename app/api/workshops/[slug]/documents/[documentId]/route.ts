import { NextRequest, NextResponse } from "next/server";
import { get } from "@vercel/blob";
import { prisma } from "@/lib/db";
import { resolveWorkshopAccess } from "@/lib/crm/workshop-access";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ slug: string; documentId: string }> };

export async function GET(_req: NextRequest, ctx: Ctx) {
  const { slug, documentId } = await ctx.params;

  const edition = await prisma.workshopEdition.findUnique({
    where: { slug },
    select: { id: true, productId: true },
  });
  if (!edition) return NextResponse.json({ error: "not_found" }, { status: 404 });

  // Same access model as the workshop detail page (OWNER always, member/
  // staff-as-contact with a real enrollment) — re-verified here on every
  // download, not just once at page render. No productId means no purchase
  // to key access off of, so (unlike the page) we block by default rather
  // than treating it as fully public.
  const { hasAccess } = edition.productId
    ? await resolveWorkshopAccess(edition.productId)
    : { hasAccess: false };
  if (!hasAccess) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const document = await prisma.workshopDocument.findFirst({
    where: { id: documentId, workshopEditionId: edition.id },
  });
  if (!document) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const result = await get(document.url, { access: "private" });
  if (!result || result.statusCode !== 200 || !result.stream) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  return new NextResponse(result.stream, {
    headers: {
      "Content-Type": document.mimeType,
      "Content-Disposition": `attachment; filename="${document.filename.replace(/"/g, "")}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
