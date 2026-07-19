import { NextResponse } from "next/server";
import { resolveMember } from "@/lib/auth/api-member";
import { revokeAllMemberSessions } from "@/lib/auth/member-sessions";

export const dynamic = "force-dynamic";

export const POST = async () => {
  const member = await resolveMember();
  if (member instanceof NextResponse) return member;

  await revokeAllMemberSessions(member.account.id);

  return NextResponse.json({ ok: true });
};
