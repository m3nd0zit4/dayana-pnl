import {
  NotificationCampaignStatus,
  NotificationDeliveryStatus,
  type Contact,
} from "@prisma/client";
import { renderQuickMessage } from "@/lib/crm/render-message";
import { prisma } from "@/lib/db";
import type { NotificationAudience, OutboundChannel } from "./config";
import { dispatchAndRecord } from "./dispatch";
import { contactVars, workshopVars } from "./variables";

export const BROADCAST_BATCH_SIZE = 25;
export const BROADCAST_SYNC_MAX_CONTACTS = 10;

export type CampaignContactRow = Pick<
  Contact,
  "id" | "firstName" | "lastName" | "displayName" | "phoneE164" | "email"
>;

export const listCampaignAudience = async (
  audience: NotificationAudience
): Promise<CampaignContactRow[]> => {
  const where =
    audience === "MARKETING_CONSENT"
      ? { consentMarketingAt: { not: null } }
      : {};

  return prisma.contact.findMany({
    where,
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      displayName: true,
      email: true,
      phoneE164: true,
    },
  });
};

export type CreateBroadcastInput = {
  name: string;
  templateKey: string;
  channels: OutboundChannel[];
  audience: NotificationAudience;
  workshopEditionId?: string;
  createdByStaffId?: string;
};

export const createBroadcastCampaign = async (input: CreateBroadcastInput) => {
  const template = await prisma.messageTemplate.findUnique({
    where: { key_locale: { key: input.templateKey, locale: "es" } },
  });
  if (!template) {
    throw new Error(`Plantilla no encontrada: ${input.templateKey}`);
  }

  const edition = input.workshopEditionId
    ? await prisma.workshopEdition.findUnique({
        where: { id: input.workshopEditionId },
      })
    : null;

  const contacts = await listCampaignAudience(input.audience);

  const campaign = await prisma.notificationCampaign.create({
    data: {
      name: input.name,
      templateKey: input.templateKey,
      channels: input.channels,
      audience: input.audience,
      workshopEditionId: input.workshopEditionId ?? null,
      status: NotificationCampaignStatus.DRAFT,
      totalTargets: contacts.length * input.channels.length,
      createdByStaffId: input.createdByStaffId ?? null,
    },
  });

  return { campaign, template, edition, contacts };
};

export type CampaignRunContext = {
  campaignId: string;
  templateKey: string;
  templateBody: string;
  templateTitle: string;
  channels: OutboundChannel[];
  workshopEdition: Awaited<
    ReturnType<typeof prisma.workshopEdition.findUnique>
  >;
  contacts: CampaignContactRow[];
};

export const loadCampaignRunContext = async (
  campaignId: string
): Promise<CampaignRunContext | null> => {
  const campaign = await prisma.notificationCampaign.findUnique({
    where: { id: campaignId },
    include: { workshopEdition: true },
  });
  if (!campaign) return null;

  const template = await prisma.messageTemplate.findUnique({
    where: { key_locale: { key: campaign.templateKey, locale: "es" } },
  });
  if (!template) throw new Error("Plantilla no encontrada");

  const channels = campaign.channels as OutboundChannel[];
  const audience = campaign.audience as NotificationAudience;
  const contacts = await listCampaignAudience(audience);

  return {
    campaignId,
    templateKey: campaign.templateKey,
    templateBody: template.body,
    templateTitle: template.title,
    channels,
    workshopEdition: campaign.workshopEdition,
    contacts,
  };
};

const recipientForChannel = (
  contact: CampaignContactRow,
  channel: OutboundChannel
): string | null => {
  if (channel === "EMAIL") return contact.email;
  if (channel === "SMS" || channel === "WHATSAPP_API") return contact.phoneE164;
  return null;
};

export const processCampaignBatch = async (
  ctx: CampaignRunContext,
  offset: number,
  batchSize: number
) => {
  const slice = ctx.contacts.slice(offset, offset + batchSize);
  let sent = 0;
  let failed = 0;
  let skipped = 0;

  for (const contact of slice) {
    const vars = ctx.workshopEdition
      ? workshopVars(contact as Contact, ctx.workshopEdition)
      : contactVars(contact as Contact);
    const body = renderQuickMessage(ctx.templateBody, vars);

    for (const channel of ctx.channels) {
      const recipient = recipientForChannel(contact, channel);
      const { result } = await dispatchAndRecord({
        contactId: contact.id,
        channel,
        templateKey: ctx.templateKey,
        subject: ctx.templateTitle,
        body,
        campaignId: ctx.campaignId,
        vars,
        recipient: recipient ?? undefined,
      });

      if (result.status === NotificationDeliveryStatus.SENT) sent += 1;
      else if (result.status === NotificationDeliveryStatus.FAILED) failed += 1;
      else skipped += 1;
    }
  }

  if (sent + failed + skipped > 0) {
    await prisma.notificationCampaign.update({
      where: { id: ctx.campaignId },
      data: {
        sentCount: { increment: sent },
        failedCount: { increment: failed },
        skippedCount: { increment: skipped },
      },
    });
  }

  return { sent, failed, skipped, processed: slice.length };
};

export const startCampaignRun = async (campaignId: string) => {
  const ctx = await loadCampaignRunContext(campaignId);
  if (!ctx) throw new Error("Campaña no encontrada");

  await prisma.notificationCampaign.update({
    where: { id: campaignId },
    data: {
      status: NotificationCampaignStatus.RUNNING,
      startedAt: new Date(),
      totalTargets: ctx.contacts.length * ctx.channels.length,
      sentCount: 0,
      failedCount: 0,
      skippedCount: 0,
    },
  });

  return ctx;
};

export const finalizeCampaignRun = async (campaignId: string) => {
  await prisma.notificationCampaign.update({
    where: { id: campaignId },
    data: {
      status: NotificationCampaignStatus.COMPLETED,
      completedAt: new Date(),
    },
  });
};

export const runBroadcastCampaign = async (campaignId: string) => {
  const campaign = await prisma.notificationCampaign.findUnique({
    where: { id: campaignId },
  });
  if (!campaign) throw new Error("Campaña no encontrada");
  if (campaign.status === NotificationCampaignStatus.COMPLETED) {
    return { alreadyCompleted: true };
  }

  const ctx = await startCampaignRun(campaignId);
  let totals = { sent: 0, failed: 0, skipped: 0 };

  for (let i = 0; i < ctx.contacts.length; i += BROADCAST_BATCH_SIZE) {
    const batch = await processCampaignBatch(ctx, i, BROADCAST_BATCH_SIZE);
    totals = {
      sent: totals.sent + batch.sent,
      failed: totals.failed + batch.failed,
      skipped: totals.skipped + batch.skipped,
    };
  }

  await finalizeCampaignRun(campaignId);
  return { ...totals, contacts: ctx.contacts.length };
};
