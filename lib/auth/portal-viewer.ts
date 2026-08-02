import crypto from "crypto";
import { ContactSource, type Contact } from "@prisma/client";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { getStaffById } from "@/lib/crm/staff";
import { canManageTeam } from "@/lib/crm/staff-permissions";
import { EMAIL_SIGNUP_PLACEHOLDER_PHONE_PREFIX } from "@/lib/crm/member-accounts";
import { getMemberSession } from "./member-session";

export type PortalViewer = { contact: Contact; isOwner: boolean };

/**
 * OWNER-only bridge into the member portal (courses, workshop materials):
 * lets the owner browse using her staff session, without a member login.
 * Staff emails are deliberately barred from ever getting a MemberAccount
 * (see upsertMemberAccountForGoogle / getOrCreateContactForEmailSignup in
 * lib/crm/member-accounts.ts) — this never creates one, it only
 * finds-or-creates the Contact row that staff checkout already uses
 * (resolveSessionCheckoutContact), just enough for FK-backed writes
 * (progress, comments) to land somewhere real.
 *
 * Only use this for portal *viewing* and course-interaction routes. Account
 * management (password, sessions, notification prefs) needs a real
 * MemberAccount — keep those on getMemberSession()/resolveMember() directly.
 */
export const getPortalViewer = async (): Promise<PortalViewer | null> => {
  const member = await getMemberSession();
  if (member) return { contact: member.contact, isOwner: false };

  const session = await auth();
  if (session?.user?.kind !== "staff" || !session.user.id) return null;

  const staff = await getStaffById(session.user.id);
  if (!staff?.isActive || !canManageTeam(staff.role)) return null;

  const existing = await prisma.contact.findUnique({ where: { email: staff.email } });
  if (existing) return { contact: existing, isOwner: true };

  const name = staff.displayName?.trim() || staff.email.split("@")[0];
  const [firstName, ...rest] = name.split(/\s+/);
  const created = await prisma.contact.create({
    data: {
      email: staff.email,
      firstName: firstName || staff.email.split("@")[0],
      lastName: rest.length > 0 ? rest.join(" ") : null,
      displayName: name,
      phoneE164: `${EMAIL_SIGNUP_PLACEHOLDER_PHONE_PREFIX}:${crypto.randomUUID()}`,
      source: ContactSource.WEB,
      sourceDetail: "owner-portal-access",
    },
  });
  return { contact: created, isOwner: true };
};
