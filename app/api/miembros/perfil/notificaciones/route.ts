import { NextResponse } from "next/server";
import { resolveMember } from "@/lib/auth/api-member";
import { updateMemberNotificationPrefs } from "@/lib/crm/member-accounts";
import { updateNotificationPrefsSchema } from "@/lib/validations/member";

export const dynamic = "force-dynamic";

export const PATCH = async (req: Request) => {
  const member = await resolveMember();
  if (member instanceof NextResponse) return member;

  const parsed = updateNotificationPrefsSchema.safeParse(
    await req.json().catch(() => null)
  );
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  await updateMemberNotificationPrefs(member.contact.id, parsed.data);

  return NextResponse.json({ ok: true });
};
