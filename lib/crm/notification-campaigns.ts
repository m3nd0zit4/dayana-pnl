import { prisma } from "../db";

export type CampaignListItem = {
  id: string;
  name: string;
  templateKey: string;
  status: string;
  totalTargets: number;
  sentCount: number;
  failedCount: number;
  skippedCount: number;
  createdAt: string;
  workshopTitle: string | null;
};

/** Últimas campañas de notificación (página Notificaciones + polling). */
export const listRecentCampaigns = async (
  take = 30
): Promise<CampaignListItem[]> => {
  const campaigns = await prisma.notificationCampaign.findMany({
    orderBy: { createdAt: "desc" },
    take,
    include: { workshopEdition: { select: { title: true } } },
  });

  return campaigns.map((c) => ({
    id: c.id,
    name: c.name,
    templateKey: c.templateKey,
    status: c.status,
    totalTargets: c.totalTargets,
    sentCount: c.sentCount,
    failedCount: c.failedCount,
    skippedCount: c.skippedCount,
    createdAt: c.createdAt.toISOString(),
    workshopTitle: c.workshopEdition?.title ?? null,
  }));
};
