import { NextResponse } from "next/server";
import { parsePhoneNumberFromString } from "libphonenumber-js";
import { resolveMember } from "@/lib/auth/api-member";
import { updateMemberProfile } from "@/lib/crm/member-accounts";
import { writeAuditLog } from "@/lib/crm/audit";
import { updateProfileSchema } from "@/lib/validations/member";

export const dynamic = "force-dynamic";

export const PATCH = async (req: Request) => {
  const member = await resolveMember();
  if (member instanceof NextResponse) return member;

  const parsed = updateProfileSchema.safeParse(
    await req.json().catch(() => null)
  );
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  let phoneE164: string | null = null;
  let phoneCountryIso: string | null = null;
  const rawPhone = parsed.data.phone?.trim();
  if (rawPhone) {
    const parsedPhone = parsePhoneNumberFromString(rawPhone);
    if (!parsedPhone?.isValid()) {
      return NextResponse.json({ error: "invalid_phone" }, { status: 400 });
    }
    phoneE164 = parsedPhone.number;
    phoneCountryIso = parsedPhone.country ?? null;
  }

  try {
    await updateMemberProfile(member.contact.id, {
      firstName: parsed.data.firstName,
      lastName: parsed.data.lastName,
      phoneE164,
      phoneCountryIso,
      workDescription: parsed.data.workDescription,
      themePreference: parsed.data.themePreference,
      preferredLocale: parsed.data.preferredLocale,
    });
  } catch (e) {
    if (e instanceof Error && e.message === "PHONE_TAKEN") {
      return NextResponse.json({ error: "phone_taken" }, { status: 409 });
    }
    throw e;
  }

  await writeAuditLog({
    action: "MEMBER_PROFILE_UPDATED",
    entityType: "Contact",
    entityId: member.contact.id,
  }).catch(() => undefined);

  return NextResponse.json({ ok: true });
};
