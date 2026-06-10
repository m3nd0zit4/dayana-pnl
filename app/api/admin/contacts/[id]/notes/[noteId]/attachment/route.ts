import { NextResponse } from "next/server";
import { getDownloadUrl } from "@vercel/blob";
import { resolveAdminStaff } from "@/lib/auth/api-staff";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

type RouteCtx = { params: Promise<{ id: string; noteId: string }> };

export async function GET(_req: Request, ctx: RouteCtx) {
  const staff = await resolveAdminStaff();
  if (staff instanceof NextResponse) return staff;

  const { id: contactId, noteId } = await ctx.params;
  const note = await prisma.contactNote.findFirst({
    where: { id: noteId, contactId },
    select: { attachmentUrl: true, attachmentMime: true, attachmentName: true },
  });

  if (!note?.attachmentUrl) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  return NextResponse.json({
    url: getDownloadUrl(note.attachmentUrl),
    mime: note.attachmentMime,
    name: note.attachmentName,
  });
}
