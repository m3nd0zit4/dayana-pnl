import { auth } from "@/auth";
import type { Contact, MemberAccount } from "@prisma/client";
import { getMemberByContactId } from "@/lib/crm/member-accounts";
import {
  touchMemberSession,
  validateMemberSession,
} from "@/lib/auth/member-sessions";
import { readRequestMeta } from "@/lib/auth/request-meta";

export type MemberSessionData = {
  contact: Contact;
  account: MemberAccount;
};

export const getMemberSession = async (): Promise<MemberSessionData | null> => {
  const session = await auth();
  if (session?.user?.kind !== "member") return null;
  const contactId = session.user.id;
  const sessionId = session.user.sessionId;
  if (!contactId || !sessionId) return null;

  const member = await getMemberByContactId(contactId);
  if (!member?.account) return null;

  // Session validity + lastSeen heartbeat run in background (jwt callback already validated).
  void (async () => {
    const row = await validateMemberSession(sessionId);
    if (!row) return;
    const fiveMinMs = 5 * 60 * 1000;
    if (Date.now() - row.lastSeenAt.getTime() >= fiveMinMs) {
      const meta = await readRequestMeta();
      await touchMemberSession(sessionId, meta).catch(() => undefined);
    }
  })();

  return { contact: member.contact, account: member.account };
};

export const requireMemberSession = async (): Promise<MemberSessionData> => {
  const member = await getMemberSession();
  if (!member) {
    throw new Error("MEMBER_UNAUTHORIZED");
  }
  return member;
};
