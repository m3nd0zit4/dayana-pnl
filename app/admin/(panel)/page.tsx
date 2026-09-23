import DashboardClient, {
  type WhatsAppHomeSummary,
} from "@/app/components/admin/crm/DashboardClient";
import { prisma } from "@/lib/db";
import { isWhatsAppAutoReplyEnabled } from "@/lib/crm/whatsapp-autoreply";
import { isWhatsAppWorkspaceAvailable } from "@/lib/crm/whatsapp-agent/workspace";
import { isCrmUiPreview } from "@/lib/auth/preview";
import { getStaffSession } from "@/lib/auth/staff-session";
import {
  getDashboardStats,
  PREVIEW_DASHBOARD,
  type DashboardStats,
} from "@/lib/crm/dashboard-stats";

export const dynamic = "force-dynamic";

/** Lo que enseña el botón verde de WhatsApp. Un fallo aquí no tira la portada. */
const whatsAppSummary = async (): Promise<WhatsAppHomeSummary | null> => {
  if (!(await isWhatsAppWorkspaceAvailable())) return null;
  try {
    const [unread, handedOff, aiEnabled] = await Promise.all([
      prisma.conversation.aggregate({
        where: { channel: "WHATSAPP", status: { not: "CLOSED" } },
        _sum: { unreadCount: true },
      }),
      prisma.conversation.count({
        where: { channel: "WHATSAPP", aiPausedReason: "escalation" },
      }),
      isWhatsAppAutoReplyEnabled(),
    ]);
    return { unread: unread._sum.unreadCount ?? 0, handedOff, aiEnabled };
  } catch {
    return null;
  }
};

const AdminDashboardPage = async () => {
  const preview = isCrmUiPreview();
  if (preview) {
    return (
      <DashboardClient
        initialData={PREVIEW_DASHBOARD}
        whatsapp={{ unread: 3, handedOff: 1, aiEnabled: true }}
      />
    );
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

  return (
    <DashboardClient
      initialData={data}
      dbError={dbError}
      whatsapp={await whatsAppSummary()}
    />
  );
};

export default AdminDashboardPage;
