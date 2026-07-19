import { NextResponse } from "next/server";
import { resolveMember } from "@/lib/auth/api-member";
import { revokeMemberSession, validateMemberSession } from "@/lib/auth/member-sessions";

export const dynamic = "force-dynamic";

type RouteCtx = { params: Promise<{ id: string }> };

export const POST = async (_req: Request, ctx: RouteCtx) => {
  const member = await resolveMember();
  if (member instanceof NextResponse) return member;

  const { id: sessionId } = await ctx.params;

  const row = await validateMemberSession(sessionId);
  if (!row || row.memberAccountId !== member.account.id) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  await revokeMemberSession(sessionId);

  return NextResponse.json({ ok: true });
};
