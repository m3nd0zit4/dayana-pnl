import { NextResponse } from "next/server";
import { resolveAdminStaff } from "@/lib/auth/api-staff";
import {
  channelConfigured,
  emailProviderId,
  getConfiguredChannels,
  isDryRun,
  isNotificationsEnabled,
  NOTIFICATION_CHANNELS,
} from "@/lib/notifications/config";

export const dynamic = "force-dynamic";

export async function GET() {
  const staff = await resolveAdminStaff();
  if (staff instanceof NextResponse) return staff;

  return NextResponse.json({
    enabled: isNotificationsEnabled(),
    dryRun: isDryRun(),
    emailProvider: emailProviderId(),
    channels: NOTIFICATION_CHANNELS.map((channel) => ({
      channel,
      configured: channelConfigured(channel),
    })),
    configured: getConfiguredChannels(),
  });
}
