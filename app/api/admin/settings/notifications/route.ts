import type { NotificationEventType } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";
import { apiError, readJson, withStaff } from "@/lib/api/handler";
import { fireAuditLog } from "@/lib/crm/audit";
import { NOTIFICATION_CATALOG } from "@/lib/notifications/platform/catalog";
import {
  MAX_RETENTION_DAYS,
  MIN_RETENTION_DAYS,
  RETENTION_SETTING_KEYS,
  getNotificationSiteConfig,
  setNotificationSiteConfig,
} from "@/lib/notifications/platform/site-config";
import {
  getNotificationsRuntimeStatus,
} from "@/lib/notifications/health";

export const dynamic = "force-dynamic";

const EVENT_TYPES = Object.keys(
  NOTIFICATION_CATALOG
) as [NotificationEventType, ...NotificationEventType[]];

const days = z
  .number()
  .int()
  .min(MIN_RETENTION_DAYS)
  .max(MAX_RETENTION_DAYS);

const patchSchema = z
  .object({
    retention: z
      .object({
        dismissedDays: days,
        readDays: days,
        unreadDays: days,
        notificationDays: days,
        deliveryDays: days,
      })
      .partial()
      .optional(),
    disabledEventTypes: z.array(z.enum(EVENT_TYPES)).max(EVENT_TYPES.length).optional(),
    staffAlertInbox: z.union([z.email(), z.literal("")]).nullable().optional(),
    enabledOverride: z.boolean().nullable().optional(),
    dryRunOverride: z.boolean().nullable().optional(),
  })
  .refine(
    (value) => Object.keys(value).length > 0,
    { message: "empty_patch" }
  );

export const GET = withStaff("owner", async () => {
  const config = await getNotificationSiteConfig();
  return NextResponse.json({
    ...config,
    retentionKeys: RETENTION_SETTING_KEYS,
    // Solo lectura: vienen del entorno, no de la base.
    runtime: getNotificationsRuntimeStatus(),
  });
});

export const PATCH = withStaff("owner", async ({ req, staff }) => {
  const parsed = patchSchema.safeParse(await readJson(req));
  if (!parsed.success) {
    return apiError("invalid_body", 400);
  }

  await setNotificationSiteConfig(parsed.data);

  fireAuditLog({
    staffUserId: staff.id,
    action: "UPDATE",
    entityType: "SiteSetting",
    entityId: "notification_settings",
    changes: parsed.data,
  });

  const config = await getNotificationSiteConfig();
  return NextResponse.json({
    ok: true,
    ...config,
    runtime: getNotificationsRuntimeStatus(),
  });
});
