import WorkshopsPageClient from "@/app/components/admin/crm/WorkshopsPageClient";
import type { WorkshopRow } from "@/app/components/admin/crm/WorkshopFormModal";
import { isCrmUiPreview } from "@/lib/auth/preview";
import { prisma } from "@/lib/db";
import { PROXIMO_WORKSHOP_SLUG } from "@/lib/workshops";
import { WorkshopEditionStatus } from "@prisma/client";

export const dynamic = "force-dynamic";

const PREVIEW_WORKSHOPS: WorkshopRow[] = [
  {
    id: "pw-proximo",
    slug: PROXIMO_WORKSHOP_SLUG,
    title: "Próximo taller",
    editionLabel: null,
    cardSummary: null,
    status: WorkshopEditionStatus.DRAFT,
    dateLabel: null,
    scheduleLabel: null,
    capacity: null,
    whatsappTemplate: null,
    startsAt: null,
  },
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

const sortEditions = (rows: WorkshopRow[]): WorkshopRow[] =>
  [...rows].sort((a, b) => {
    if (a.slug === PROXIMO_WORKSHOP_SLUG) return -1;
    if (b.slug === PROXIMO_WORKSHOP_SLUG) return 1;
    return 0;
  });

const WorkshopsAdminPage = async () => {
  const preview = isCrmUiPreview();
  let editions = PREVIEW_WORKSHOPS;

  if (!preview) {
    try {
      await prisma.workshopEdition.upsert({
        where: { slug: PROXIMO_WORKSHOP_SLUG },
        create: {
          slug: PROXIMO_WORKSHOP_SLUG,
          title: "Próximo taller",
          status: WorkshopEditionStatus.DRAFT,
          productId: "workshop-virtual",
        },
        update: {},
      });

      const rows = await prisma.workshopEdition.findMany({
        orderBy: { createdAt: "desc" },
      });
      editions = sortEditions(rows.map(toRow));
    } catch {
      editions = [];
    }
  }

  return <WorkshopsPageClient editions={editions} preview={preview} />;
};

export default WorkshopsAdminPage;
