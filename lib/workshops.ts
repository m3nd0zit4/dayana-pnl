export type WorkshopStatus = "completed" | "upcoming" | "open";

export type WorkshopScheduleSlot = {
  startTime: string;
  endTime: string;
  title: string;
  /** Rango legible en landing (se genera al guardar). */
  time?: string;
};

/** Tarjeta en el listado de talleres. */
export type WorkshopCard = {
  slug: string;
  status: WorkshopStatus;
  editionLabel: string;
  title: string;
  cardSummary: string;
  dateLabel: string;
  scheduleLabel: string;
  whatsappMessage?: string;
};

/** Landing completa de un taller activo. */
export type WorkshopDetail = WorkshopCard & {
  heroLines: [string, string, string];
  detailSummary: string;
  intro: string;
  focusTopics: string[];
  daySchedule: WorkshopScheduleSlot[];
  topicsSectionTitle: string;
  topicsSectionDescription: string;
  scheduleSectionDescription: string;
  whatsappMessage: string;
  metadata: {
    title: string;
    description: string;
  };
  ctaMessage: string;
};

/** @deprecated Use WorkshopCard */
export type Workshop = WorkshopCard;

export const DEFAULT_TOPICS_SECTION_TITLE = "Qué trabajamos";
export const DEFAULT_SCHEDULE_SECTION_TITLE = "Estructura del día";

export const DEFAULT_OPEN_CTA =
  "Escríbenos por WhatsApp para reservar tu cupo o resolver dudas sobre esta edición.";

export const WORKSHOP_DETAIL_SEED = {
  heroLines: ["Saca tu", "mejor", "versión"] as [string, string, string],
  detailSummary:
    "Jornada intensiva de PNL en vivo por Google Meet: conciencia, reprogramación de creencias y programación de futuro con Dayana Beltrán.",
  intro:
    "Esta edición del taller virtual ya se realizó. Aquí puedes revisar el contenido de la jornada; para terapias, cursos en vivo o próximas fechas, escríbenos por WhatsApp.",
  focusTopics: [
    "Metodologías de herramientas coaching en desarrollo personal",
    "Despertar de conciencia",
    "Introspección profunda",
    "Identificación de creencias limitantes y bloqueos",
    "Metodologías y estructuras coaching para crear metas, proyectos y objetivos",
    "Definición clara de metas y enfoque",
    "Ley de causa y efecto",
    "Reprogramación de creencias limitantes y bloqueos",
    "Corte de lasos energeticos",
    "Programación de futuro",
    "Listos a tomar acción",
  ],
  daySchedule: [
    {
      startTime: "07:30",
      endTime: "08:00",
      title: "Apertura y bienvenida",
      time: "7:30 a.m. – 8:00 a.m.",
    },
    {
      startTime: "08:00",
      endTime: "09:00",
      title: "Despertar de conciencia + introspección",
      time: "8:00 a.m. – 9:00 a.m.",
    },
    {
      startTime: "09:00",
      endTime: "10:00",
      title: "Creencias limitantes",
      time: "9:00 a.m. – 10:00 a.m.",
    },
    {
      startTime: "10:00",
      endTime: "11:00",
      title: "Metodologías y estructuras para metas, proyectos y objetivos",
      time: "10:00 a.m. – 11:00 a.m.",
    },
    {
      startTime: "11:00",
      endTime: "12:00",
      title: "Definición clara de metas y enfoque personal",
      time: "11:00 a.m. – 12:00 p.m.",
    },
    {
      startTime: "12:00",
      endTime: "12:30",
      title: "Ley de causa y efecto",
      time: "12:00 p.m. – 12:30 p.m.",
    },
    {
      startTime: "12:30",
      endTime: "13:10",
      title: "Almuerzo (40 minutos)",
      time: "12:30 p.m. – 1:10 p.m.",
    },
    {
      startTime: "13:10",
      endTime: "13:20",
      title: "Tiempo de espera breve para reinicio del grupo",
      time: "1:10 p.m. – 1:20 p.m.",
    },
    {
      startTime: "13:20",
      endTime: "15:30",
      title:
        "Reprogramación de eventos emocionales y creencias limitantes + corte de losos energeticos (trabajo profundo grupal)",
      time: "1:20 p.m. – 3:30 p.m.",
    },
    {
      startTime: "15:30",
      endTime: "16:30",
      title: "Programación de futuro para tomar acción y cierre",
      time: "3:30 p.m. – 4:30 p.m.",
    },
  ],
  topicsSectionTitle: "Qué trabajamos",
  topicsSectionDescription:
    "Contenido práctico para claridad mental, enfoque y cambios sostenibles que se vivió en la jornada.",
  scheduleSectionDescription:
    "Así fue la jornada virtual: de apertura a cierre, con bloques de trabajo guiado y aplicación práctica en tiempo real.",
  metaTitle:
    "Taller Virtual — Saca Tu Mejor Versión | Dayana Beltrán PNL",
  metaDescription:
    "Edición del taller virtual Saca tu mejor versión. Conoce el contenido y escríbenos por WhatsApp para próximas fechas.",
} as const;

export const PROXIMO_WORKSHOP_SLUG = "proximo-taller";

/** Tarjeta visual en la web cuando no hay taller con inscripciones abiertas. */
export const PROXIMO_WORKSHOP_CARD: WorkshopCard = {
  slug: PROXIMO_WORKSHOP_SLUG,
  status: "upcoming",
  editionLabel: "",
  title: "",
  cardSummary: "",
  dateLabel: "",
  scheduleLabel: "",
};

export const isVirtualWorkshopSlug = (slug: string): boolean =>
  slug === PROXIMO_WORKSHOP_SLUG;

/** Ediciones reales (sin placeholder) ordenadas para el listado público. */
export const buildPublicWorkshopListing = (
  cards: WorkshopCard[]
): WorkshopCard[] => {
  const real = cards.filter((card) => !isVirtualWorkshopSlug(card.slug));
  const sorted = [...real].sort((a, b) => {
    if (a.status === "open") return -1;
    if (b.status === "open") return 1;
    return 0;
  });

  if (sorted.some((card) => card.status === "open")) {
    return sorted;
  }

  return [PROXIMO_WORKSHOP_CARD, ...sorted];
};

const WORKSHOP_CATALOG: WorkshopCard[] = [
  {
    slug: "saca-tu-mejor-version",
    status: "completed",
    editionLabel: "Edición 2026",
    title: "Saca tu mejor versión",
    cardSummary: WORKSHOP_DETAIL_SEED.detailSummary,
    dateLabel: "16 de mayo de 2026",
    scheduleLabel: "7:30 a.m. – 4:30 p.m. · virtual",
    whatsappMessage:
      "Hola Dayana, me interesa información sobre próximos talleres virtuales o nuevas fechas de Saca tu mejor versión.",
  },
];

export const WORKSHOPS = buildPublicWorkshopListing(WORKSHOP_CATALOG);

export const isLockedWorkshopSlug = (_slug: string): boolean => false;

const STATUS_LABEL: Record<WorkshopStatus, string> = {
  completed: "Completado",
  upcoming: "Próximamente",
  open: "Inscripciones abiertas",
};

export const getWorkshopStatusLabel = (status: WorkshopStatus): string =>
  STATUS_LABEL[status];

export const splitTitleToHeroLines = (title: string): [string, string, string] => {
  const words = title.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return ["", "", ""];
  if (words.length === 1) return [words[0]!, "", ""];
  if (words.length === 2) return [words[0]!, words[1]!, ""];
  const third = words.slice(2).join(" ");
  return [words[0]!, words[1]!, third];
};
