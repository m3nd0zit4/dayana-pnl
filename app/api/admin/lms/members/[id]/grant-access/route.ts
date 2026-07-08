import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { requireWriteStaff } from "@/lib/auth/api-staff";
import { hashPassword } from "@/lib/auth/password";
import { fireAuditLog } from "@/lib/crm/audit";
import { getMemberByContactId, setMemberPassword } from "@/lib/crm/member-accounts";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ id: string }> };

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
export async function POST(_req: NextRequest, { params }: RouteParams) {
  const staff = await requireWriteStaff();
  if (staff instanceof NextResponse) return staff;

  const { id: contactId } = await params;
  const member = await getMemberByContactId(contactId);
  if (!member) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
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
}
