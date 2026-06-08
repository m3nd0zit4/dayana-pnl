import NotificationsPageClient from "@/app/components/admin/crm/NotificationsPageClient";
import { isCrmUiPreview } from "@/lib/auth/preview";
import { getStaffSession } from "@/lib/auth/staff-session";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function AdminNotificationsPage() {
  if (isCrmUiPreview()) {
    return (
      <NotificationsPageClient preview campaigns={[]} />
    );
  }

  const staff = await getStaffSession();
  if (!staff) return null;

  const campaigns = await prisma.notificationCampaign.findMany({
    orderBy: { createdAt: "desc" },
    take: 30,
    include: { workshopEdition: { select: { title: true } } },
  });

  return (
    <NotificationsPageClient
      preview={false}
      staffEmail={staff.email}
      campaigns={campaigns.map((c) => ({
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
      }))}
    />
  );
}
