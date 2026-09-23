import WhatsAppAgendaClient from "@/app/components/admin/whatsapp/WhatsAppAgendaClient";
import { isCrmUiPreview } from "@/lib/auth/preview";
import { getStaffSession } from "@/lib/auth/staff-session";
import { prisma } from "@/lib/db";
import { defaultWhatsAppAiConfig, getWhatsAppAiConfig } from "@/lib/crm/whatsapp-ai-config";

export const dynamic = "force-dynamic";

/** Citas del último mes en adelante. */
const monthAgo = () => new Date(Date.now() - 30 * 24 * 3600_000);

const Page = async () => {
  if (isCrmUiPreview()) {
    return (
      <WhatsAppAgendaClient
        initialBooking={defaultWhatsAppAiConfig().booking}
        bookings={[]}
        canEdit={false}
        calendarAccounts={1}
      />
    );
  }
  const staff = await getStaffSession();
  if (!staff) return null;

  const [config, rows, calendarAccounts] = await Promise.all([
    getWhatsAppAiConfig(),
    prisma.whatsAppBooking.findMany({
      where: { startsAt: { gte: monthAgo() } },
      orderBy: { startsAt: "asc" },
      take: 200,
    }),
    prisma.googleAccount.count({ where: { isActive: true, services: { has: "CALENDAR" } } }),
  ]);

  return (
    <WhatsAppAgendaClient
      initialBooking={config.booking}
      bookings={rows.map((b) => ({
        id: b.id,
        conversationId: b.conversationId,
        name: b.name,
        phone: b.phone,
        service: b.service,
        startsAt: b.startsAt.toISOString(),
        meetUrl: b.meetUrl,
        status: b.status,
      }))}
      canEdit={staff.role === "OWNER"}
      calendarAccounts={calendarAccounts}
    />
  );
};

export default Page;
