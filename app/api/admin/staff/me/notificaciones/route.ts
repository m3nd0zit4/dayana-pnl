import { NextResponse } from "next/server";
import { resolveAdminStaff } from "@/lib/auth/api-staff";
import { updateStaffNotificationPrefs } from "@/lib/crm/staff";
import { updateStaffNotificationPrefsSchema } from "@/lib/validations/admin";

export const dynamic = "force-dynamic";

export const PATCH = async (req: Request) => {
  const staff = await resolveAdminStaff();
  if (staff instanceof NextResponse) return staff;

  const parsed = updateStaffNotificationPrefsSchema.safeParse(
    await req.json().catch(() => null)
  );
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  await updateStaffNotificationPrefs(staff.id, parsed.data);

  return NextResponse.json({ ok: true });
};
