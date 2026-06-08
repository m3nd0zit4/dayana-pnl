import { NextRequest, NextResponse } from "next/server";
import { requireWriteStaff } from "@/lib/auth/api-staff";
import {
  NOTIFICATION_CHANNELS,
  type NotificationAudience,
  type OutboundChannel,
  isNotificationsEnabled,
  getConfiguredChannels,
} from "@/lib/notifications/config";
import {
  BROADCAST_SYNC_MAX_CONTACTS,
  createBroadcastCampaign,
  runBroadcastCampaign,
} from "@/lib/notifications/campaigns";
import { emitCampaignRun } from "@/lib/inngest/events";

export const dynamic = "force-dynamic";

const parseChannels = (raw: unknown): OutboundChannel[] => {
  if (!Array.isArray(raw)) return ["EMAIL"];
  return raw.filter((c): c is OutboundChannel =>
    NOTIFICATION_CHANNELS.includes(c as OutboundChannel)
  );
};

export async function POST(req: NextRequest) {
  const staff = await requireWriteStaff();
  if (staff instanceof NextResponse) return staff;

  if (!isNotificationsEnabled()) {
    return NextResponse.json(
      {
        error: "notifications_disabled",
        hint: "Activa NOTIFICATIONS_ENABLED=true en .env",
      },
      { status: 503 }
    );
  }

  const body = await req.json().catch(() => null);
  const templateKey = String(body?.templateKey ?? "workshop_open").trim();
  const name = String(body?.name ?? "Campaña CRM").trim();
  const audience = (body?.audience === "MARKETING_CONSENT"
    ? "MARKETING_CONSENT"
    : "ALL_CONTACTS") as NotificationAudience;
  const channels = parseChannels(body?.channels);
  const workshopEditionId = body?.workshopEditionId
    ? String(body.workshopEditionId)
    : undefined;
  const runNow = body?.runNow !== false;

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
    const { campaign, contacts } = await createBroadcastCampaign({
      name,
      templateKey,
      channels,
      audience,
      workshopEditionId,
      createdByStaffId: staff.id,
    });

    if (runNow) {
      const started = Date.now();
      const inngestConfigured = Boolean(process.env.INNGEST_EVENT_KEY?.trim());

      if (inngestConfigured) {
        await emitCampaignRun(campaign.id);
      } else if (contacts.length > BROADCAST_SYNC_MAX_CONTACTS) {
        return NextResponse.json(
          {
            error: "inngest_required",
            hint: `Más de ${BROADCAST_SYNC_MAX_CONTACTS} contactos requiere Inngest (INNGEST_EVENT_KEY).`,
          },
          { status: 422 }
        );
      } else {
        await runBroadcastCampaign(campaign.id);
      }

      if (process.env.NODE_ENV === "development") {
        console.log(
          `[api] POST /api/admin/notifications/broadcast ${Date.now() - started}ms (${contacts.length} contacts, inngest=${inngestConfigured})`
        );
      }
    }

    const updated = await import("@/lib/db").then(({ prisma }) =>
      prisma.notificationCampaign.findUnique({ where: { id: campaign.id } })
    );

    return NextResponse.json({
      campaign: updated,
      contactCount: contacts.length,
      queued: runNow && Boolean(process.env.INNGEST_EVENT_KEY?.trim()),
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "broadcast_failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
