export type WorkshopStatus = "completed" | "upcoming" | "open";

export type WorkshopScheduleSlot = {
  time: string;
  title: string;
};

export type Workshop = {
  slug: string;
  status: WorkshopStatus;
  editionLabel: string;
  title: string;
  heroLines: [string, string, string];
  cardSummary: string;
  dateLabel: string;
  scheduleLabel: string;
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
};

export const WORKSHOPS: Workshop[] = [
  {
    slug: "saca-tu-mejor-version",
    status: "completed",
    editionLabel: "Edición 2026",
    title: "Saca tu mejor versión",
    heroLines: ["Saca tu", "mejor", "versión"],
    cardSummary:
      "Jornada intensiva de PNL en vivo por Google Meet: conciencia, reprogramación de creencias y programación de futuro.",
    dateLabel: "16 de mayo de 2026",
    scheduleLabel: "7:30 a.m. – 4:30 p.m. · virtual",
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
      { time: "7:30 a.m. – 8:00 a.m.", title: "Apertura y bienvenida" },
      {
        time: "8:00 a.m. – 9:00 a.m.",
        title: "Despertar de conciencia + introspección",
      },
      { time: "9:00 a.m. – 10:00 a.m.", title: "Creencias limitantes" },
      {
        time: "10:00 a.m. – 11:00 a.m.",
        title: "Metodologías y estructuras para metas, proyectos y objetivos",
      },
      {
        time: "11:00 a.m. – 12:00 p.m.",
        title: "Definición clara de metas y enfoque personal",
      },
      { time: "12:00 p.m. – 12:30 p.m.", title: "Ley de causa y efecto" },
      { time: "12:30 p.m. – 1:10 p.m.", title: "Almuerzo (40 minutos)" },
      {
        time: "1:10 p.m. – 1:20 p.m.",
        title: "Tiempo de espera breve para reinicio del grupo",
      },
      {
        time: "1:20 p.m. – 3:30 p.m.",
        title:
          "Reprogramación de eventos emocionales y creencias limitantes + corte de losos energeticos (trabajo profundo grupal)",
      },
      {
        time: "3:30 p.m. – 4:30 p.m.",
        title: "Programación de futuro para tomar acción y cierre",
      },
    ],
    topicsSectionTitle: "Qué trabajamos",
    topicsSectionDescription:
      "Contenido práctico para claridad mental, enfoque y cambios sostenibles que se vivió en la jornada.",
    scheduleSectionDescription:
      "Así fue la jornada virtual: de apertura a cierre, con bloques de trabajo guiado y aplicación práctica en tiempo real.",
    whatsappMessage:
      "Hola Dayana, me interesa información sobre próximos talleres virtuales o nuevas fechas de Saca tu mejor versión.",
    metadata: {
      title:
        "Taller Virtual — Saca Tu Mejor Versión (completado) | Dayana Beltrán PNL",
      description:
        "Edición del taller virtual Saca tu mejor versión, realizado el 16 de mayo de 2026. Conoce el contenido y escríbenos por WhatsApp para próximas fechas.",
    },
  },
];

export const WORKSHOP_SLUGS = WORKSHOPS.map((w) => w.slug);

export const getWorkshopBySlug = (slug: string): Workshop | undefined =>
  WORKSHOPS.find((w) => w.slug === slug);

export const isWorkshopSlug = (value: string): value is Workshop["slug"] =>
  WORKSHOP_SLUGS.includes(value);

const STATUS_LABEL: Record<WorkshopStatus, string> = {
  completed: "Completado",
  upcoming: "Próximamente",
  open: "Inscripciones abiertas",
};

export const getWorkshopStatusLabel = (status: WorkshopStatus): string =>
  STATUS_LABEL[status];
