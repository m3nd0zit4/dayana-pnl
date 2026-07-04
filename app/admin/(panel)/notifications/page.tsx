import NotificationsPageClient from "@/app/components/admin/crm/NotificationsPageClient";
import { isCrmUiPreview } from "@/lib/auth/preview";
import { getStaffSession } from "@/lib/auth/staff-session";
import { listRecentCampaigns } from "@/lib/crm/notification-campaigns";

export const dynamic = "force-dynamic";

export default async function AdminNotificationsPage() {
  if (isCrmUiPreview()) {
    return (
      <NotificationsPageClient preview campaigns={[]} />
    );
  }

  const staff = await getStaffSession();
  if (!staff) return null;

  const campaigns = await listRecentCampaigns();

  return (
    <NotificationsPageClient
      preview={false}
      staffEmail={staff.email}
      campaigns={campaigns}
    />
  );
}
