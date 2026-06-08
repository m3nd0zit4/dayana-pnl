import { NextResponse } from "next/server";
import { resolveAdminStaff } from "@/lib/auth/api-staff";
import { listActiveTherapies, listTherapyLeads } from "@/lib/crm/therapies-list";
import { isCrmUiPreview } from "@/lib/auth/preview";

export const dynamic = "force-dynamic";

export async function GET() {
  if (isCrmUiPreview()) {
    return NextResponse.json({
      therapies: [
        {
          enrollmentId: "prev-e1",
          contactId: "preview-1",
          contactName: "María González",
          phoneE164: "+34612345678",
          timezone: "Europe/Madrid",
          productTitle: "Terapia 6 sesiones",
          status: "ACTIVE",
          sessionsUsed: 2,
          sessionsTotal: 6,
          nextSessionAt: new Date(Date.now() + 86400000).toISOString(),
          nextSessionNumber: 3,
        },
      ],
    });
  }

  const staff = await resolveAdminStaff();
  if (staff instanceof NextResponse) return staff;

  try {
    const [therapies, leads] = await Promise.all([
      listActiveTherapies(),
      listTherapyLeads(),
    ]);
    return NextResponse.json({ therapies, leads });
  } catch {
    return NextResponse.json({ error: "database_unavailable" }, { status: 503 });
  }
}
