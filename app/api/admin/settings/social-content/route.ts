import { NextResponse } from "next/server";
import { z } from "zod";
import { apiError, readJson, withStaff } from "@/lib/api/handler";
import { fireAuditLog } from "@/lib/crm/audit";
import {
  setSocialPublishingOverride,
  setTiktokAuditedOverride,
} from "@/lib/tiktok/resolve-flags";

const patchSchema = z
  .object({
    socialPublishingEnabled: z.boolean().nullable().optional(),
    tiktokAudited: z.boolean().nullable().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "empty_patch",
  });

export const PATCH = withStaff("owner", async ({ req, staff }) => {
  const parsed = patchSchema.safeParse(await readJson(req));
  if (!parsed.success) {
    return apiError("invalid_body", 400);
  }

  const { socialPublishingEnabled, tiktokAudited } = parsed.data;

  if (socialPublishingEnabled !== undefined) {
    await setSocialPublishingOverride(socialPublishingEnabled);
    fireAuditLog({
      staffUserId: staff.id,
      action:
        socialPublishingEnabled === null
          ? "SOCIAL_PUBLISHING_OVERRIDE_RESET"
          : socialPublishingEnabled
            ? "SOCIAL_PUBLISHING_OVERRIDE_ON"
            : "SOCIAL_PUBLISHING_OVERRIDE_OFF",
      entityType: "SiteSetting",
      entityId: "social_publishing_override",
      changes: { enabled: socialPublishingEnabled },
    });
  }

  if (tiktokAudited !== undefined) {
    await setTiktokAuditedOverride(tiktokAudited);
    fireAuditLog({
      staffUserId: staff.id,
      action:
        tiktokAudited === null
          ? "TIKTOK_AUDITED_OVERRIDE_RESET"
          : tiktokAudited
            ? "TIKTOK_AUDITED_OVERRIDE_ON"
            : "TIKTOK_AUDITED_OVERRIDE_OFF",
      entityType: "SiteSetting",
      entityId: "tiktok_audited_override",
      changes: { audited: tiktokAudited },
    });
  }

  return NextResponse.json({ ok: true });
});
