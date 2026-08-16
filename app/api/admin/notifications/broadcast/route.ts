import { NextRequest, NextResponse } from "next/server";
import { requireBroadcastStaff } from "@/lib/auth/api-staff";
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

export async function POST(req: NextRequest) {
  const staff = await requireBroadcastStaff();
  if (staff instanceof NextResponse) return staff;

  if (!(await resolveNotificationsEnabled())) {
    return NextResponse.json(
      {
        error: "notifications_disabled",
        hint: "Activa NOTIFICATIONS_ENABLED=true en .env",
      },
      { status: 503 }
    );
  }

  const raw = await req.json().catch(() => null);
  const parsed = broadcastSchema.safeParse(raw ?? {});
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_fields" }, { status: 400 });
  }

  const templateKey = parsed.data.templateKey;
  const name = parsed.data.name;
  const audience = parsed.data.audience as NotificationAudience;
  const channels = parseChannels(parsed.data.channels);
  const workshopEditionId = parsed.data.workshopEditionId;
  const runNow = parsed.data.runNow !== false;

  if (channels.length === 0) {
    return NextResponse.json({ error: "no_channels" }, { status: 400 });
  }

  const configured = getConfiguredChannels();
  const missing = channels.filter((c) => !configured.includes(c));
  if (missing.length > 0) {
    return NextResponse.json(
      {
        error: "channels_not_configured",
        missing,
        configured,
      },
      { status: 422 }
    );
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
        return NextResponse.json(
          {
            error: "inngest_required",
            hint: `Más de ${BROADCAST_SYNC_MAX_CONTACTS} contactos requiere Inngest (INNGEST_EVENT_KEY + INNGEST_SIGNING_KEY).`,
          },
          { status: 422 }
        );
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
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
