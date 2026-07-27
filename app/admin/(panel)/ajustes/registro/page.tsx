import NotificationDeliveryLogClient from "@/app/components/admin/crm/settings/NotificationDeliveryLogClient";
import { requireOwnerSettings } from "@/app/admin/(panel)/ajustes/owner-gate";

export const dynamic = "force-dynamic";

const Page = async () => {
  await requireOwnerSettings();

  return <NotificationDeliveryLogClient />;
};

export default Page;
