import type { Plan } from "../lib/plans";

/**
 * Contenido inicial del catálogo. La única fuente de verdad en runtime es la
 * DB (Product + ProductPrice); este archivo solo alimenta el seed y los
 * backfills. Editar precios/textos vivos: /admin/products.
 */
export const SEED_PLANS: Plan[] = [
  {
    id: "therapy-1",
    kind: "therapy",
    title: "Sesión Única",
    sessions: "1 sesión",
    sessionsCount: 1,
    amountUsd: 80,
    therapyPresentation: {
      sessionsHeadline: "1 sesión personalizada (1 a 1)",
    },
    features: [
      "1 hora por sesión",
      "Modalidad: Sesiones 1:1 en vivo por Google Meet (desde la comodidad de tu casa)",
      "Reprogramación de 1 a 2 eventos",
    ],
    whatsappMessage:
      "Hola Dayana, me interesa la Sesión Única de terapia PNL ($80 USD).",
  },
  {
    id: "therapy-3",
    kind: "therapy",
    title: "Primer Paso",
    sessions: "3 sesiones",
    sessionsCount: 3,
    amountUsd: 140,
    listAmountUsd: 240,
    therapyPresentation: {
      sessionsHeadline: "3 sesiones privadas (1 a 1)",
    },
    features: [
      "1 hora por sesión",
      "Modalidad: Sesiones 1:1 en vivo por Google Meet (desde la comodidad de tu casa)",
      "Reprogramación de 1 a 2 eventos por sesión",
      "Semana 1: se realizan dos sesiones (ejemplo: martes y jueves)",
      "Semana 2: se realiza la tercera sesión (Inicio de semana)",
      "Duración total: 1 semana y media",
    ],
    whatsappMessage:
      "Hola Dayana, me interesa el paquete Primer Paso (3 sesiones de terapia PNL, $140 USD).",
  },
  {
    id: "therapy-6",
    kind: "therapy",
    title: "Transformación",
    sessions: "6 sesiones",
    sessionsCount: 6,
    amountUsd: 280,
    listAmountUsd: 480,
    tag: "Más elegido",
    highlight: true,
    therapyPresentation: {
      sessionsHeadline: "6 sesiones privadas (1 a 1)",
    },
    features: [
      "1 hora por sesión",
      "Modalidad: Sesiones 1:1 en vivo por Google Meet (desde la comodidad de tu casa)",
      "Reprogramación de 1 a 2 eventos por sesión",
      "Calendario: 2 sesiones por semana durante 3 semanas (6 terapias en total).",
      "Duración aproximada del paquete: 3 semanas.",
    ],
    whatsappMessage:
      "Hola Dayana, me interesa el paquete Transformación (6 sesiones de terapia PNL, $280 USD).",
  },
  {
    id: "therapy-12",
    kind: "therapy",
    title: "Evolución Profunda",
    sessions: "12 sesiones",
    sessionsCount: 12,
    amountUsd: 560,
    listAmountUsd: 960,
    therapyPresentation: {
      sessionsHeadline: "12 sesiones privadas (1 a 1)",
    },
    features: [
      "1 hora por sesión",
      "Modalidad: Sesiones 1:1 en vivo por Google Meet (desde la comodidad de tu casa)",
      "Reprogramación de 1 a 2 eventos por sesión",
      "Calendario: 2 sesiones por semana durante 6 semanas (12 terapias en total).",
      "Duración aproximada del proceso: 1 mes y 2 semanas.",
    ],
    whatsappMessage:
      "Hola Dayana, me interesa el paquete Evolución Profunda (12 sesiones de terapia PNL, $560 USD).",
  },
  {
    id: "therapy-24",
    kind: "therapy",
    title: "Acompañamiento Total",
    sessions: "24 sesiones",
    sessionsCount: 24,
    amountUsd: 1120,
    listAmountUsd: 1920,
    therapyPresentation: {
      sessionsHeadline: "24 sesiones privadas (1 a 1)",
    },
    features: [
      "1 hora por sesión",
      "Modalidad: Sesiones 1:1 en vivo por Google Meet (desde la comodidad de tu casa)",
      "Reprogramación de 1 a 2 eventos por sesión",
      "Calendario: 2 sesiones por semana durante 12 semanas (24 terapias en total).",
      "Duración aproximada del proceso: 2 meses y 2 semanas.",
    ],
    whatsappMessage:
      "Hola Dayana, me interesa el paquete Acompañamiento Total (24 sesiones de terapia PNL, $1120 USD).",
  },
  {
    id: "course-live",
    kind: "course",
    title: "Curso en vivo",
    sessions: "Mensualidad",
    amountUsd: 35,
    unitPrice: "por mes",
    features: [
      "Clases en vivo por Google Meet",
      "Grabaciones disponibles 1 mes en el portal",
      "Módulos del curso en el portal de miembros",
      "Espacio real para compartir",
    ],
    whatsappMessage:
      "Hola Dayana, quiero información e inscripción al curso en vivo por Google Meet.",
  },
  {
    id: "workshop-virtual",
    kind: "course",
    title: "Taller virtual",
    sessions: "Saca tu mejor versión",
    amountUsd: 50,
    features: [
      "Taller virtual jornada completa",
      "Sábado 16 de mayo · 7:30 a.m. a 4:30 p.m.",
    ],
    whatsappMessage:
      "Hola Dayana, quiero asegurar mi cupo para el taller virtual Saca Tu Mejor Versión (16 de mayo, $50 USD). Te envío comprobante o necesito ayuda con el pago.",
  },
];

export const SEED_PLANS_BY_ID: Record<string, Plan> = Object.fromEntries(
  SEED_PLANS.map((plan) => [plan.id, plan])
);

/** Precios COP explícitos (pesos completos, sin centavos). */
export const COP_PRICES: Record<string, { amount: number; listAmount?: number }> = {
  "therapy-1":  { amount: 280_000 },
  "therapy-3":  { amount: 490_000,   listAmount: 840_000 },
  "therapy-6":  { amount: 980_000,   listAmount: 1_680_000 },
  "therapy-12": { amount: 1_960_000, listAmount: 3_360_000 },
  "therapy-24": { amount: 3_920_000, listAmount: 6_720_000 },
  "course-live":{ amount: 122_500 },
};
