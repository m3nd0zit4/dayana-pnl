import type { MessageChannel } from "@prisma/client";

export type NotificationAudience = "ALL_CONTACTS" | "MARKETING_CONSENT";

export const NOTIFICATION_CHANNELS = [
  "EMAIL",
  "SMS",
  "WHATSAPP_API",
] as const satisfies readonly MessageChannel[];

export type OutboundChannel = (typeof NOTIFICATION_CHANNELS)[number];

export const isNotificationsEnabled = (): boolean =>
  process.env.NOTIFICATIONS_ENABLED === "true";

export const isDryRun = (): boolean =>
  process.env.NOTIFICATIONS_DRY_RUN === "true" ||
  (process.env.NODE_ENV !== "production" &&
    process.env.NOTIFICATIONS_DRY_RUN !== "false");

export const emailFrom = (): { email: string; name: string } => ({
  email:
    process.env.NOTIFICATIONS_EMAIL_FROM?.trim() ||
    process.env.SMTP_USER?.trim() ||
    "contacto@dayanabeltran.com",
  name:
    process.env.NOTIFICATIONS_EMAIL_FROM_NAME?.trim() || "Dayana Beltrán PNL",
});

export const siteUrl = (): string =>
  process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") ||
  "http://localhost:3000";

export const emailProviderId = (): "resend" | "smtp" | null => {
  if (process.env.RESEND_API_KEY?.trim()) return "resend";
  if (
    process.env.SMTP_HOST?.trim() &&
    process.env.SMTP_USER?.trim() &&
    process.env.SMTP_PASS?.trim()
  ) {
    return "smtp";
  }
  return null;
};

export const smsProviderReady = (): boolean =>
  Boolean(
    process.env.TWILIO_ACCOUNT_SID?.trim() &&
      process.env.TWILIO_AUTH_TOKEN?.trim() &&
      process.env.TWILIO_FROM_NUMBER?.trim()
  );

export const whatsAppApiReady = (): boolean =>
  Boolean(
    process.env.WHATSAPP_API_TOKEN?.trim() &&
      process.env.WHATSAPP_PHONE_NUMBER_ID?.trim()
  );

export const channelConfigured = (channel: OutboundChannel): boolean => {
  switch (channel) {
    case "EMAIL":
      return emailProviderId() !== null;
    case "SMS":
      return smsProviderReady();
    case "WHATSAPP_API":
      return whatsAppApiReady();
    default:
      return false;
  }
};

export const getConfiguredChannels = (): OutboundChannel[] =>
  NOTIFICATION_CHANNELS.filter(channelConfigured);
