export type PlanId =
  | "therapy-1"
  | "therapy-3"
  | "therapy-6"
  | "therapy-12"
  | "therapy-24"
  | "course-live";

export type PlanKind = "therapy" | "course";

/** Titular bajo el precio; el detalle va en `features` (fichitas). */
export type TherapyPlanPresentation = {
  sessionsHeadline: string;
};

export type Plan = {
  id: PlanId;
  kind: PlanKind;
  title: string;
  sessions: string;
  /** Precio promocional cobrado (checkout). */
  amountUsd: number;
  /**
   * Valor de referencia (lista) mayor que `amountUsd` cuando hay promoción.
   * Si no se define o es igual a `amountUsd`, la carta muestra un solo precio.
   */
  listAmountUsd?: number;
  /** Solo curso u otros productos no terapia (p. ej. "por persona"). */
  unitPrice?: string;
  tag?: string;
  highlight?: boolean;
  /** Terapia: titular; curso: sin usar. Detalle en `features`. */
  therapyPresentation?: TherapyPlanPresentation;
  features: string[];
  whatsappMessage: string;
};

/** Ahorro en USD si hay lista por encima del precio promocional; si no, `null`. */
export function getTherapySavingsUsd(plan: Plan): number | null {
  if (plan.kind !== "therapy" || plan.listAmountUsd == null) return null;
  const save = plan.listAmountUsd - plan.amountUsd;
  return save > 0 ? save : null;
}

export const CURRENCY = "usd";

export const PLANS: Record<PlanId, Plan> = {
  "therapy-1": {
    id: "therapy-1",
    kind: "therapy",
    title: "Terapia",
    sessions: "1 Sesión Privada",
    amountUsd: 80,
    therapyPresentation: {
      sessionsHeadline: "1 sesión Personalizada(1 a 1)",
    },
    features: [
      "1 hora por sesión",
      "Modalidad: Seciones 1:1 en vivo por Google Meet (desde la comodidad de tu casa)",
      "Reprogramación de 1 a 2 eventos",
    ],
    whatsappMessage:
      "Hola Dayana, me interesa el paquete de 1 sesión de terapia PNL ($80 USD).",
  },
  "therapy-3": {
    id: "therapy-3",
    kind: "therapy",
    title: "Terapia Basica",
    sessions: "Paquete de 3 Sesiones",
    amountUsd: 140,
    listAmountUsd: 240,
    therapyPresentation: {
      sessionsHeadline: "3 sesiones privadas (1 a 1)",
    },
    features: [
      "1 hora por sesión",
      "Modalidad: Seciones 1:1 en vivo por Google Meet (desde la comodidad de tu casa)",
      "Reprogramación de 1 a 2 eventos por sesión",
      "Semana 1: se realizan dos sesiones (ejemplo: martes y jueves)",
      "Semana 2: se realiza la tercera sesión (Inicio de semana)",
      "Duración total: 1 semana y media",
    ],
    whatsappMessage:
      "Hola Dayana, me interesa el paquete de 3 sesiones de terapia PNL ($140 USD).",
  },
  
  "therapy-6": {
    id: "therapy-6",
    kind: "therapy",
    title: "Terapia Inicio de Transformacion",
    sessions: "Paquete de 6 Sesiones",
    amountUsd: 280,
    listAmountUsd: 480,
    tag: "Más elegido",
    highlight: true,
    therapyPresentation: {
      sessionsHeadline: "6 sesiones privadas (1 a 1)",
    },
    features: [
      "1 hora por sesión",
      "Modalidad: Seciones 1:1 en vivo por Google Meet (desde la comodidad de tu casa)",
      "Reprogramación de 1 a 2 eventos por sesión",
      "Calendario: 2 sesiones por semana durante 3 semanas (6 terapias en total).",
      "Duración aproximada del paquete: 3 semanas.",
    ],
    whatsappMessage:
      "Hola Dayana, me interesa el paquete de 6 sesiones de terapia PNL ($280 USD).",
  },
  
  "therapy-12": {
    id: "therapy-12",
    kind: "therapy",
    title: "Terapia Transformacion Avanzada",
    sessions: "Paquete de 12 Sesiones",
    amountUsd: 560,
    listAmountUsd: 960,
    therapyPresentation: {
      sessionsHeadline: "12 sesiones privadas (1 a 1)",
    },
    features: [
      "1 hora por sesión",
      "Modalidad: Seciones 1:1 en vivo por Google Meet (desde la comodidad de tu casa)",
      "Reprogramación de 1 a 2 eventos por sesión",
      "Calendario: 2 sesiones por semana durante 6 semanas (12 terapias en total).",
      "Duración aproximada del proceso: 1 mes y 2 semanas.",
    ],
    whatsappMessage:
      "Hola Dayana, me interesa el paquete de 12 sesiones de terapia PNL ($560 USD).",
  },
  "therapy-24": {
    id: "therapy-24",
    kind: "therapy",
    title: "Terapia Transformacion Premium",
    sessions: "Paquete de 24 Sesiones",
    amountUsd: 1120,
    listAmountUsd: 1920,
    therapyPresentation: {
      sessionsHeadline: "24 sesiones privadas (1 a 1)",
    },
    features: [
      "1 hora por sesión",
      "Modalidad: Seciones 1:1 en vivo por Google Meet (desde la comodidad de tu casa)",
      "Reprogramación de 1 a 2 eventos por sesión",
      "Calendario: 2 sesiones por semana durante 12 semanas (24 terapias en total).",
      "Duración aproximada del proceso: 2 meses y 2 semanas.",
    ],
    whatsappMessage:
      "Hola Dayana, me interesa el paquete de 24 sesiones de terapia PNL ($1120 USD).",
  },
  "course-live": {
    id: "course-live",
    kind: "course",
    title: "Curso en vivo",
    sessions: "Inscripción",
    amountUsd: 35,
    unitPrice: "por persona",
    features: [
      "Grupo en Google Meet",
      "Cupo máximo 30 personas",
      "Espacio real para compartir",
    ],
    whatsappMessage:
      "Hola Dayana, quiero inscribirme al próximo curso en vivo ($35 USD).",
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
