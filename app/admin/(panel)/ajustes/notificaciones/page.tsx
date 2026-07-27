import SiteNotificationSettingsClient from "@/app/components/admin/crm/settings/SiteNotificationSettingsClient";
import { requireOwnerSettings } from "@/app/admin/(panel)/ajustes/owner-gate";
import { getNotificationsRuntimeStatus } from "@/lib/notifications/health";
import { getNotificationSiteConfig } from "@/lib/notifications/platform/site-config";

export const dynamic = "force-dynamic";

const Page = async () => {
  await requireOwnerSettings();

  const config = await getNotificationSiteConfig();

  return (
    <SiteNotificationSettingsClient
      initialConfig={{
        retention: config.retention,
        disabledEventTypes: config.disabledEventTypes,
        staffAlertInbox: config.staffAlertInbox,
      }}
      runtime={getNotificationsRuntimeStatus()}
    />
  );
};

export default Page;
