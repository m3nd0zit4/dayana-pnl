import WorkshopsPageClient from "@/app/components/admin/crm/WorkshopsPageClient";
import type { WorkshopRow } from "@/app/components/admin/crm/WorkshopFormModal";
import { isCrmUiPreview } from "@/lib/auth/preview";
import { prisma } from "@/lib/db";
import { WorkshopEditionStatus } from "@prisma/client";

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
  },
];

const toRow = (e: {
  id: string;
  slug: string;
  title: string;
  editionLabel: string | null;
  cardSummary: string | null;
  status: WorkshopEditionStatus;
  dateLabel: string | null;
  scheduleLabel: string | null;
  capacity: number | null;
  whatsappTemplate: string | null;
  startsAt: Date | null;
}): WorkshopRow => ({
  id: e.id,
  slug: e.slug,
  title: e.title,
  editionLabel: e.editionLabel,
  cardSummary: e.cardSummary,
  status: e.status,
  dateLabel: e.dateLabel,
  scheduleLabel: e.scheduleLabel,
  capacity: e.capacity,
  whatsappTemplate: e.whatsappTemplate,
  startsAt: e.startsAt?.toISOString() ?? null,
});

const WorkshopsAdminPage = async () => {
  const preview = isCrmUiPreview();
  let editions = PREVIEW_WORKSHOPS;

  if (!preview) {
    try {
      const rows = await prisma.workshopEdition.findMany({
        orderBy: { createdAt: "desc" },
      });
      editions = rows.map(toRow);
    } catch {
      editions = [];
    }
  }

  return <WorkshopsPageClient editions={editions} preview={preview} />;
};

export default WorkshopsAdminPage;
