import { NextResponse } from "next/server";
import { getPortalViewer } from "@/lib/auth/portal-viewer";
import { getMembershipForContact } from "@/lib/lms/membership";
import { getPublishedModule } from "@/lib/lms/course-content";
import {
  markModuleComplete,
  markModuleIncomplete,
} from "@/lib/lms/module-progress";

export const dynamic = "force-dynamic";

type RouteCtx = { params: Promise<{ id: string }> };

const requireCurrentMember = async (moduleId: string) => {
  const member = await getPortalViewer();
  if (!member) return { error: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };

  const membership = await getMembershipForContact(member.contact.id, {
    isOwner: member.isOwner,
  });
  if (!membership.isCurrent) {
    return { error: NextResponse.json({ error: "membership_inactive" }, { status: 403 }) };
  }

  const productId = membership.enrollment?.product.id;
  const courseModule = productId
    ? await getPublishedModule(productId, moduleId)
    : null;
  if (!courseModule) {
    return { error: NextResponse.json({ error: "not_found" }, { status: 404 }) };
  }

  return { contactId: member.contact.id };
};

export async function POST(_req: Request, ctx: RouteCtx) {
  const { id } = await ctx.params;
  const result = await requireCurrentMember(id);
  if ("error" in result) return result.error;

  await markModuleComplete(result.contactId, id);
  return NextResponse.json({ ok: true, completed: true });
}

export async function DELETE(_req: Request, ctx: RouteCtx) {
  const { id } = await ctx.params;
  const result = await requireCurrentMember(id);
  if ("error" in result) return result.error;

  await markModuleIncomplete(result.contactId, id);
  return NextResponse.json({ ok: true, completed: false });
}
