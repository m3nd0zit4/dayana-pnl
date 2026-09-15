import type { NotificationEventType } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";
import { apiError, readJson, withStaff } from "@/lib/api/handler";
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

export const GET = withStaff("read", async ({ staff }) => {
  const preferences = await resolveStaffPreferences(staff.id, staff.role);
  return NextResponse.json({ preferences, notifyEmail: staff.notifyEmail });
});

export const PATCH = withStaff("read", async ({ req, staff }) => {
  const parsed = patchSchema.safeParse(await readJson(req));
  if (!parsed.success) {
    return apiError("invalid_body", 400);
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
});
