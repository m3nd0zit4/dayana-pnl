export type PlanId =
  | "therapy-1"
  | "therapy-3"
  | "therapy-6"
  | "therapy-12"
  | "therapy-24"
  | "course-live";

export type PlanKind = "therapy" | "course";

export type Plan = {
  id: PlanId;
  kind: PlanKind;
  title: string;
  sessions: string;
  amountUsd: number;
  unitPrice?: string;
  tag?: string;
  highlight?: boolean;
  features: string[];
  whatsappMessage: string;
};

export const CURRENCY = "usd";

export const PLANS: Record<PlanId, Plan> = {
  "therapy-1": {
    id: "therapy-1",
    kind: "therapy",
    title: "Inicio",
    sessions: "1 Sesión",
    amountUsd: 80,
    unitPrice: "por sesión",
    features: [
      "Videollamada 1:1",
      "Plan personalizado",
      "Seguimiento por WhatsApp",
    ],
    whatsappMessage:
      "Hola Dayana, me interesa el paquete de 1 sesión de terapia PNL ($80 USD).",
  },
  "therapy-3": {
    id: "therapy-3",
    kind: "therapy",
    title: "Exploración",
    sessions: "3 Sesiones",
    amountUsd: 120,
    unitPrice: "$40 por sesión",
    features: [
      "3 encuentros 1:1",
      "Ahorro vs. sesión suelta",
      "Ejercicios entre sesiones",
    ],
    whatsappMessage:
      "Hola Dayana, me interesa el paquete de 3 sesiones de terapia PNL ($120 USD).",
  },
  "therapy-6": {
    id: "therapy-6",
    kind: "therapy",
    title: "Transformación",
    sessions: "6 Sesiones",
    amountUsd: 240,
    unitPrice: "$40 por sesión",
    tag: "Más elegido",
    highlight: true,
    features: [
      "6 encuentros 1:1",
      "Cambios sostenidos",
      "Material de apoyo incluido",
    ],
    whatsappMessage:
      "Hola Dayana, me interesa el paquete de 6 sesiones de terapia PNL ($240 USD).",
  },
  "therapy-12": {
    id: "therapy-12",
    kind: "therapy",
    title: "Inmersión",
    sessions: "12 Sesiones",
    amountUsd: 480,
    unitPrice: "$40 por sesión",
    features: [
      "12 encuentros 1:1",
      "Seguimiento extendido",
      "Ajuste de proceso personalizado",
    ],
    whatsappMessage:
      "Hola Dayana, me interesa el paquete de 12 sesiones de terapia PNL ($480 USD).",
  },
  "therapy-24": {
    id: "therapy-24",
    kind: "therapy",
    title: "Maestría",
    sessions: "24 Sesiones",
    amountUsd: 900,
    unitPrice: "$37.5 por sesión",
    features: [
      "24 encuentros profundos",
      "Mejor ahorro por sesión",
      "Acompañamiento continuo",
    ],
    whatsappMessage:
      "Hola Dayana, me interesa el paquete de 24 sesiones de terapia PNL ($900 USD).",
  },
  "course-live": {
    id: "course-live",
    kind: "course",
    title: "Curso en vivo",
    sessions: "Inscripción",
    amountUsd: 30,
    unitPrice: "por persona",
    features: [
      "Grupo en Google Meet",
      "Cupo máximo 30 personas",
      "Espacio real para compartir",
    ],
    whatsappMessage:
      "Hola Dayana, quiero inscribirme al próximo curso en vivo ($30 USD).",
  },
};

export const THERAPY_PLANS: Plan[] = [
  PLANS["therapy-1"],
  PLANS["therapy-3"],
  PLANS["therapy-6"],
  PLANS["therapy-12"],
  PLANS["therapy-24"],
];

export const COURSE_PLAN: Plan = PLANS["course-live"];

export const isPlanId = (value: unknown): value is PlanId =>
  typeof value === "string" && value in PLANS;

export const getPlan = (id: PlanId): Plan => PLANS[id];

const usdFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

export const formatUsd = (usd: number): string => usdFormatter.format(usd);
