import crypto from "crypto";
import { NextResponse } from "next/server";
import { apiError, withStaff } from "@/lib/api/handler";
import { hashPassword } from "@/lib/auth/password";
import { fireAuditLog } from "@/lib/crm/audit";
import { getMemberByContactId, setMemberPassword } from "@/lib/crm/member-accounts";

export const dynamic = "force-dynamic";

type Params = { id: string };

/** Readable-ish random password, e.g. "k3m9-p7qz-4wxr" (16 chars, no email needed). */
const generatePassword = () =>
  crypto
    .randomBytes(9)
    .toString("base64url")
    .replace(/[_-]/g, "x")
    .match(/.{1,4}/g)!
    .join("-");

/**
 * Grants portal access to an existing CRM contact directly — sets a
 * freshly generated password on the spot instead of waiting on an invite
 * email. Same effect as the email flow (member can log in right away),
 * just handed to staff to relay however they want (WhatsApp, in person…).
 */
export const POST = withStaff<Params>("write", async ({ staff, params }) => {
  const { id: contactId } = params;
  const member = await getMemberByContactId(contactId);
  if (!member) {
    return apiError("not_found", 404);
  }

  const password = generatePassword();
  const passwordHash = await hashPassword(password);
  await setMemberPassword(contactId, passwordHash);

  fireAuditLog({
    staffUserId: staff.id,
    action: "MEMBER_ACCESS_GRANTED",
    entityType: "Contact",
    entityId: contactId,
  });

  return NextResponse.json({ ok: true, email: member.contact.email, password });
});
