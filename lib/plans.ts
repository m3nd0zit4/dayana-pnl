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
  /** Solo productos que no son terapia por sesión (p. ej. curso: "por persona"). */
  unitPrice?: string;
  tag?: string;
  highlight?: boolean;
  features: string[];
  whatsappMessage: string;
};

const THERAPY_SESSION_COUNT: Record<Exclude<PlanId, "course-live">, number> = {
  "therapy-1": 1,
  "therapy-3": 3,
  "therapy-6": 6,
  "therapy-12": 12,
  "therapy-24": 24,
};

function formatPerSessionFromTotal(amountUsd: number, sessionCount: number): string {
  if (sessionCount <= 0) return "";
  if (sessionCount === 1) return "por sesión";
  const per = amountUsd / sessionCount;
  const rounded = Math.round(per * 100) / 100;
  const hasFraction = Math.abs(rounded - Math.round(rounded)) > 1e-9;
  const num = hasFraction
    ? rounded.toLocaleString("en-US", {
        minimumFractionDigits: 1,
        maximumFractionDigits: 2,
      })
    : String(Math.round(rounded));
  return `$${num} por sesión`;
}

/** Texto bajo el precio: terapía = derivado de `amountUsd` / sesiones; curso = `unitPrice` del plan. */
export function getPlanUnitPriceLabel(plan: Plan): string | undefined {
  if (plan.kind === "therapy") {
    const n = THERAPY_SESSION_COUNT[plan.id as Exclude<PlanId, "course-live">];
    return formatPerSessionFromTotal(plan.amountUsd, n);
  }
  return plan.unitPrice;
}

export const CURRENCY = "usd";

export const PLANS: Record<PlanId, Plan> = {
  "therapy-1": {
    id: "therapy-1",
    kind: "therapy",
    title: "Inicio",
    sessions: "1 Sesión",
    amountUsd: 80,
    features: [
      "Videollamada 1:1",
      "Personalizado",
      "Duración: 1 hora",
      "Modalidad: Videollamada",
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
    amountUsd: 140,
    features: [
      "3 encuentros 1:1",
      "Ahorro vs. sesión suelta",
      "Duración: 1 hora",
      "Modalidad: Videollamada"
    ],
    whatsappMessage:
      "Hola Dayana, me interesa el paquete de 3 sesiones de terapia PNL ($120 USD).",
  },
  "therapy-6": {
    id: "therapy-6",
    kind: "therapy",
    title: "Transformación",
    sessions: "6 Sesiones",
    amountUsd: 280,
    tag: "Más elegido",
    highlight: true,
    features: [
      "6 encuentros 1:1",
      "Cambios sostenidos",
      "Duración: 1 hora",
      "Modalidad: Videollamada",
    ],
    whatsappMessage:
      "Hola Dayana, me interesa el paquete de 6 sesiones de terapia PNL ($240 USD).",
  },
  "therapy-12": {
    id: "therapy-12",
    kind: "therapy",
    title: "Inmersión",
    sessions: "12 Sesiones",
    amountUsd: 520,
    features: [
      "12 encuentros 1:1",
      "Seguimiento extendido",
      "Ajuste de proceso personalizado",
      "Duración: 1 hora",
      "Modalidad: Videollamada",
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
    features: [
      "24 encuentros profundos",
      "Mejor ahorro por sesión",
      "Acompañamiento continuo",
      "Duración: 1 hora",
      "Modalidad: Videollamada",
    ],
    whatsappMessage:
      "Hola Dayana, me interesa el paquete de 24 sesiones de terapia PNL ($900 USD).",
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
