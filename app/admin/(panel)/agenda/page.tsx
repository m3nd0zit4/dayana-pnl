import { GoogleService } from "@prisma/client";

import AgendaPageClient, {
  type AppointmentRow,
} from "@/app/components/admin/crm/AgendaPageClient";
import { isCrmUiPreview } from "@/lib/auth/preview";
import { getStaffSession } from "@/lib/auth/staff-session";
import {
  DEFAULT_BOOKING_CONFIG,
  getBookingConfig,
  listAppointments,
} from "@/lib/crm/booking";
import { listActiveGoogleAccountsForService } from "@/lib/crm/google-accounts";
import { getSiteUrl } from "@/lib/site-url";

export const dynamic = "force-dynamic";

const AgendaPage = async () => {
  const siteUrl = getSiteUrl();

  if (isCrmUiPreview()) {
    return (
      <AgendaPageClient
        preview
        initialConfig={DEFAULT_BOOKING_CONFIG}
        initialAppointments={[]}
        siteUrl={siteUrl}
        calendarConnected
      />
    );
  }

  const staff = await getStaffSession();
  if (!staff) return null;

  const [config, rows, calendarAccounts] = await Promise.all([
    getBookingConfig(),
    listAppointments(),
    listActiveGoogleAccountsForService(GoogleService.CALENDAR),
  ]);

  const appointments: AppointmentRow[] = rows.map((a) => ({
    id: a.id,
    startsAt: a.startsAt.toISOString(),
    endsAt: a.endsAt.toISOString(),
    timezone: a.timezone,
    name: a.name,
    email: a.email,
    phone: a.phone,
    note: a.note,
    meetUrl: a.meetUrl,
    status: a.status,
    contactId: a.contactId,
  }));

  return (
    <AgendaPageClient
      preview={false}
      initialConfig={config}
      initialAppointments={appointments}
      siteUrl={siteUrl}
      calendarConnected={calendarAccounts.length > 0}
    />
  );
};

export default AgendaPage;
