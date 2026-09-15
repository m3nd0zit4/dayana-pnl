import { NextResponse } from "next/server";
import { apiError, readJson, withStaff } from "@/lib/api/handler";
import { updateStaffNotificationPrefs } from "@/lib/crm/staff";
import { updateStaffNotificationPrefsSchema } from "@/lib/validations/admin";

export const dynamic = "force-dynamic";

export const PATCH = withStaff("read", async ({ req, staff }) => {
  const parsed = updateStaffNotificationPrefsSchema.safeParse(
    await readJson(req)
  );
  if (!parsed.success) {
    return apiError("invalid_body", 400);
  }

  await updateStaffNotificationPrefs(staff.id, parsed.data);

  return NextResponse.json({ ok: true });
});
