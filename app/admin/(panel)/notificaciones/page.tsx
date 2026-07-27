import NotificationsPageClient from "@/app/components/admin/crm/NotificationsPageClient";
import { isCrmUiPreview } from "@/lib/auth/preview";

export const dynamic = "force-dynamic";

const NotificationsPage = () => {
  const preview = isCrmUiPreview();
  return <NotificationsPageClient preview={preview} />;
};

export default NotificationsPage;
