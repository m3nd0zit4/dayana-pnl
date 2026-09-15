import { NextResponse } from "next/server";
import { apiError, readJson, withStaff } from "@/lib/api/handler";
import {
  NOTIFICATION_CHANNELS,
  type NotificationAudience,
  type OutboundChannel,
  getConfiguredChannels,
} from "@/lib/notifications/config";
import {
  BROADCAST_SYNC_MAX_CONTACTS,
  createBroadcastCampaign,
  runBroadcastCampaign,
} from "@/lib/notifications/campaigns";
import { emitCampaignRun } from "@/lib/inngest/events";
import { isInngestConfigured } from "@/lib/inngest/config";
import { resolveNotificationsEnabled } from "@/lib/notifications/platform/resolve";
import { broadcastSchema } from "@/lib/validations/admin";

export const dynamic = "force-dynamic";

const parseChannels = (raw: unknown): OutboundChannel[] => {
  if (!Array.isArray(raw)) return ["EMAIL"];
  return raw.filter((c): c is OutboundChannel =>
    NOTIFICATION_CHANNELS.includes(c as OutboundChannel)
  );
};

export const POST = withStaff("broadcast", async ({ req, staff }) => {
  if (!(await resolveNotificationsEnabled())) {
    return apiError("notifications_disabled", 503, {
      hint: "Activa NOTIFICATIONS_ENABLED=true en .env",
    });
  }

  const raw = await readJson(req);
  const parsed = broadcastSchema.safeParse(raw ?? {});
  if (!parsed.success) {
    return apiError("invalid_fields", 400);
  }

  const templateKey = parsed.data.templateKey;
  const name = parsed.data.name;
  const audience = parsed.data.audience as NotificationAudience;
  const channels = parseChannels(parsed.data.channels);
  const workshopEditionId = parsed.data.workshopEditionId;
  const runNow = parsed.data.runNow !== false;

  if (channels.length === 0) {
    return apiError("no_channels", 400);
  }

  const configured = getConfiguredChannels();
  const missing = channels.filter((c) => !configured.includes(c));
  if (missing.length > 0) {
    return apiError("channels_not_configured", 422, {
      missing,
      configured,
    });
  }

  try {
    const { campaign, contactCount } = await createBroadcastCampaign({
      name,
      templateKey,
      channels,
      audience,
      workshopEditionId,
      createdByStaffId: staff.id,
    });

    if (runNow) {
      const started = Date.now();
      const inngestConfigured = isInngestConfigured();

      if (inngestConfigured) {
        await emitCampaignRun(campaign.id);
      } else if (contactCount > BROADCAST_SYNC_MAX_CONTACTS) {
        return apiError("inngest_required", 422, {
          hint: `Más de ${BROADCAST_SYNC_MAX_CONTACTS} contactos requiere Inngest (INNGEST_EVENT_KEY + INNGEST_SIGNING_KEY).`,
        });
      } else {
        await runBroadcastCampaign(campaign.id);
      }

      if (process.env.NODE_ENV === "development") {
        console.log(
          `[api] POST /api/admin/notifications/broadcast ${Date.now() - started}ms (${contactCount} contacts, inngest=${inngestConfigured})`
        );
      }
    }

    const updated = await import("@/lib/db").then(({ prisma }) =>
      prisma.notificationCampaign.findUnique({ where: { id: campaign.id } })
    );

    return NextResponse.json({
      campaign: updated,
      contactCount,
      queued: runNow && isInngestConfigured(),
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "broadcast_failed";
    return apiError(message, 400);
  }
});
