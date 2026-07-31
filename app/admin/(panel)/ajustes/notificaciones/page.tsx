import SiteNotificationSettingsClient from "@/app/components/admin/crm/settings/SiteNotificationSettingsClient";
import { requireOwnerSettings } from "@/app/admin/(panel)/ajustes/owner-gate";
import { isDryRun, isNotificationsEnabled } from "@/lib/notifications/config";
import { getNotificationsRuntimeStatus } from "@/lib/notifications/health";
import {
  resolveDryRun,
  resolveNotificationsEnabled,
} from "@/lib/notifications/platform/resolve";
import { getNotificationSiteConfig } from "@/lib/notifications/platform/site-config";

export const dynamic = "force-dynamic";

const Page = async () => {
  await requireOwnerSettings();

  const [config, effectiveEnabled, effectiveDryRun] = await Promise.all([
    getNotificationSiteConfig(),
    resolveNotificationsEnabled(),
    resolveDryRun(),
  ]);

  return (
    <SiteNotificationSettingsClient
      initialConfig={{
        retention: config.retention,
        disabledEventTypes: config.disabledEventTypes,
        staffAlertInbox: config.staffAlertInbox,
        enabledOverride: config.enabledOverride,
        dryRunOverride: config.dryRunOverride,
      }}
      runtime={getNotificationsRuntimeStatus({
        notificationsEnabled: effectiveEnabled,
        dryRun: effectiveDryRun,
      })}
      envFloor={{ enabled: isNotificationsEnabled(), dryRun: isDryRun() }}
    />
  );
};

export default Page;
