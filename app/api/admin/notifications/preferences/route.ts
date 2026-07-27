import type { NotificationEventType } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";
import { resolveAdminStaff } from "@/lib/auth/api-staff";
import {
  resolveStaffPreferences,
  setStaffPreferences,
} from "@/lib/notifications/platform/preferences";
import { NOTIFICATION_CATALOG } from "@/lib/notifications/platform/catalog";

export const dynamic = "force-dynamic";

const EVENT_TYPES = Object.keys(
  NOTIFICATION_CATALOG
) as [NotificationEventType, ...NotificationEventType[]];

const patchSchema = z.object({
  preferences: z
    .array(
      z.object({
        eventType: z.enum(EVENT_TYPES),
        inApp: z.boolean(),
        email: z.boolean(),
      })
    )
    .max(EVENT_TYPES.length),
});

export const GET = async () => {
  const staff = await resolveAdminStaff();
  if (staff instanceof NextResponse) return staff;

  const preferences = await resolveStaffPreferences(staff.id, staff.role);
  return NextResponse.json({ preferences, notifyEmail: staff.notifyEmail });
};

export const PATCH = async (req: Request) => {
  const staff = await resolveAdminStaff();
  if (staff instanceof NextResponse) return staff;

  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  // `setStaffPreferences` descarta en silencio los eventos que el rol no puede
  // recibir, así que un PATCH manipulado no suscribe a nadie a eventos ajenos.
  const saved = await setStaffPreferences(
    staff.id,
    staff.role,
    parsed.data.preferences
  );

  const preferences = await resolveStaffPreferences(staff.id, staff.role);
  return NextResponse.json({ ok: true, saved, preferences });
};
