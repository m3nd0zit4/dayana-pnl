import IntegrationsHealthClient from "@/app/components/admin/crm/settings/IntegrationsHealthClient";
import {
  getIntegrationHealth,
  getNotificationsRuntimeStatus,
} from "@/lib/notifications/health";
import { requireOwnerSettings } from "@/app/admin/(panel)/ajustes/owner-gate";
import { getStaffSession } from "@/lib/auth/staff-session";

export const dynamic = "force-dynamic";

const Page = async () => {
  await requireOwnerSettings();

  const staff = await getStaffSession();

  // `getIntegrationHealth` es puro entorno: no hace red, así que se puede
  // resolver en el render sin costo.
  return (
    <IntegrationsHealthClient
      initialIntegrations={getIntegrationHealth()}
      runtime={getNotificationsRuntimeStatus()}
      defaultTestEmail={staff?.email ?? ""}
    />
  );
};

export default Page;
