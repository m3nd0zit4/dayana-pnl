import TherapiesPageClient from "@/app/components/admin/crm/TherapiesPageClient";
import { isCrmUiPreview } from "@/lib/auth/preview";
import { listActiveTherapies, listTherapyLeads } from "@/lib/crm/therapies-list";

export const dynamic = "force-dynamic";

const PREVIEW_ACTIVE = [
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
    therapyPackageId: "prev-pkg-1",
    meetDefaultUrl: null,
    nextSessionAt: new Date(Date.now() + 86400000).toISOString(),
    nextSessionNumber: 3,
    schedulableSessionNumber: 3,
  },
];

const TherapiesPage = async () => {
  const preview = isCrmUiPreview();

  if (preview) {
    return (
      <TherapiesPageClient
        preview
        initialActive={PREVIEW_ACTIVE}
        initialLeads={[]}
      />
    );
  }

  try {
    const [initialActive, initialLeads] = await Promise.all([
      listActiveTherapies(),
      listTherapyLeads(),
    ]);
    return (
      <TherapiesPageClient
        preview={false}
        initialActive={initialActive}
        initialLeads={initialLeads}
      />
    );
  } catch {
    return (
      <TherapiesPageClient
        preview={false}
        initialActive={[]}
        initialLeads={[]}
        loadError="Base de datos no disponible"
      />
    );
  }
};

export default TherapiesPage;
