import { NextResponse } from "next/server";
import { getMemberSession, type MemberSessionData } from "./member-session";

export const resolveMember = async (): Promise<
  MemberSessionData | NextResponse
> => {
  const member = await getMemberSession();
  if (!member) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }
  return member;
};
