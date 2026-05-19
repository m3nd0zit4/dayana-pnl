export type WorkshopStatus = "completed" | "upcoming" | "open";

export type Workshop = {
  slug: string;
  status: WorkshopStatus;
  editionLabel: string;
  title: string;
  cardSummary: string;
  dateLabel: string;
  scheduleLabel: string;
  /** Solo para talleres con inscripción abierta. */
  whatsappMessage?: string;
};

export const WORKSHOPS: Workshop[] = [
  {
    slug: "saca-tu-mejor-version",
    status: "completed",
    editionLabel: "Edición 2026",
    title: "Saca tu mejor versión",
    cardSummary:
      "Jornada intensiva de PNL en vivo por Google Meet: conciencia, reprogramación de creencias y programación de futuro con Dayana Beltrán.",
    dateLabel: "16 de mayo de 2026",
    scheduleLabel: "7:30 a.m. – 4:30 p.m. · virtual",
  },
  {
    slug: "proximo-taller",
    status: "upcoming",
    editionLabel: "",
    title: "",
    cardSummary: "",
    dateLabel: "",
    scheduleLabel: "",
  },
];

const STATUS_LABEL: Record<WorkshopStatus, string> = {
  completed: "Completado",
  upcoming: "Próximamente",
  open: "Inscripciones abiertas",
};

export const getWorkshopStatusLabel = (status: WorkshopStatus): string =>
  STATUS_LABEL[status];
