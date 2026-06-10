import DashboardClient from "@/app/components/admin/crm/DashboardClient";
import { isCrmUiPreview } from "@/lib/auth/preview";
import { getStaffSession } from "@/lib/auth/staff-session";
import {
  getDashboardStats,
  PREVIEW_DASHBOARD,
  type DashboardStats,
} from "@/lib/crm/dashboard-stats";

export const dynamic = "force-dynamic";

const AdminDashboardPage = async () => {
  const preview = isCrmUiPreview();
  if (preview) {
    return <DashboardClient initialData={PREVIEW_DASHBOARD} />;
  }

  const staff = await getStaffSession();
  if (!staff) return null;

  let data: DashboardStats | null = null;
  let dbError = false;
  try {
    data = await getDashboardStats();
  } catch {
    dbError = true;
  }

  return <DashboardClient initialData={data} dbError={dbError} />;
};

export default AdminDashboardPage;
