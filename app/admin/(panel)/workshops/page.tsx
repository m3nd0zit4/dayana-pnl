import WorkshopsPageClient from "@/app/components/admin/crm/WorkshopsPageClient";
import { WorkshopEditionStatus } from "@prisma/client";
import type { WorkshopRow } from "@/app/components/admin/crm/WorkshopFormModal";
import { isCrmUiPreview } from "@/lib/auth/preview";

export const dynamic = "force-dynamic";

const PREVIEW_WORKSHOPS: WorkshopRow[] = [
  {
    id: "pw1",
    slug: "saca-tu-mejor-version",
    title: "Saca tu mejor versión",
    editionLabel: "Edición mayo 2026",
    cardSummary: "Taller virtual de reprogramación.",
    status: WorkshopEditionStatus.COMPLETED,
    dateLabel: "16 de mayo de 2026",
    scheduleLabel: "7:30 a.m. – 4:30 p.m. · virtual",
    capacity: 120,
    whatsappTemplate: null,
    startsAt: null,
    heroLine1: null,
    heroLine2: null,
    heroLine3: null,
    detailSummary: null,
    intro: null,
    focusTopics: null,
    daySchedule: null,
    topicsSectionTitle: null,
    topicsSectionDescription: null,
    scheduleSectionDescription: null,
    metaTitle: null,
    metaDescription: null,
    productId: null,
  },
];

const WorkshopsAdminPage = async () => {
  const preview = isCrmUiPreview();

  return (
    <WorkshopsPageClient
      preview={preview}
      initialEditions={preview ? PREVIEW_WORKSHOPS : undefined}
    />
  );
};

export default WorkshopsAdminPage;
