import { WorkshopEditionStatus } from "@prisma/client";
import { prisma } from "./db";
import type { Workshop, WorkshopStatus } from "./workshops";

const statusToUi = (status: WorkshopEditionStatus): WorkshopStatus => {
  switch (status) {
    case WorkshopEditionStatus.OPEN:
      return "open";
    case WorkshopEditionStatus.COMPLETED:
      return "completed";
    default:
      return "upcoming";
  }
};

export const getWorkshopsFromDb = async (): Promise<Workshop[]> => {
  try {
    const editions = await prisma.workshopEdition.findMany({
      orderBy: { startsAt: "desc" },
    });

    if (editions.length === 0) {
      const { WORKSHOPS } = await import("./workshops");
      return WORKSHOPS;
    }

    return editions.map((e) => ({
      slug: e.slug,
      status: statusToUi(e.status),
      editionLabel: e.editionLabel ?? "",
      title: e.title,
      cardSummary: e.cardSummary ?? "",
      dateLabel: e.dateLabel ?? "",
      scheduleLabel: e.scheduleLabel ?? "",
      whatsappMessage: e.whatsappTemplate ?? undefined,
    }));
  } catch {
    const { WORKSHOPS } = await import("./workshops");
    return WORKSHOPS;
  }
};
