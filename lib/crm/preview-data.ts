import { buildDiagnosticAnswers } from "@/lib/crm/diagnostic-answers";
import type { DiagnosticDetail } from "@/lib/crm/diagnostics";
import { DIAGNOSTIC_PROFILES } from "@/lib/diagnostico/profiles";
import type { DiagnosticAnswers } from "@/lib/diagnostico/questions";

/** Datos de ejemplo solo para CRM_UI_PREVIEW (sin DB). */
export const PREVIEW_CONTACTS = [
  {
    id: "preview-1",
    firstName: "María",
    lastName: "González",
    phoneE164: "+34612345678",
    enrollments: [{ product: { title: "Terapia 6 sesiones" } }],
  },
  {
    id: "preview-2",
    firstName: "Ana",
    lastName: "Restrepo",
    phoneE164: "+573101234567",
    enrollments: [
      { product: { title: "Taller virtual" } },
      { product: { title: "Curso en vivo" } },
    ],
  },
  {
    id: "preview-3",
    firstName: "Laura",
    lastName: "Martínez",
    phoneE164: "+12025550199",
    enrollments: [{ product: { title: "Terapia 1 sesión" } }],
  },
] as const;

/**
 * Respuestas crudas de cada diagnóstico de ejemplo, por id, con ids reales de
 * `lib/diagnostico/questions.ts`. Viven aparte porque la lista necesita los
 * valores crudos (`orientacion`, `cierre`) para sacar el track y el cierre
 * igual que con una fila de verdad, y el detalle las necesita ya traducidas.
 */
export const PREVIEW_DIAGNOSTIC_ANSWERS: Record<string, DiagnosticAnswers> = {
  "preview-diagnostic": {
    orientacion: "pesa",
    "foco-emocional": "ansiedad",
    tiempo: "anios",
    modalidad: "individual",
    cierre: "ya",
  },
  "preview-diagnostic-2": {
    orientacion: "avanzar",
    "foco-crecimiento": "carrera",
    tiempo: "semanas",
    modalidad: "grupo",
    cierre: "explorando",
  },
  "preview-diagnostic-3": {
    orientacion: "pesa",
    "foco-emocional": "duelo",
    tiempo: "siempre",
    modalidad: "individual",
    cierre: "mes-organizando",
  },
};

/**
 * Diagnósticos de ejemplo, con forma de `DiagnosticDetail` — el superconjunto
 * de lo que necesitan tanto la lista (`/admin/diagnosticos`, que se queda con
 * un subconjunto de campos) como el detalle (`/admin/diagnosticos/[id]`, que
 * los usa tal cual).
 */
export const PREVIEW_DIAGNOSTICS: DiagnosticDetail[] = [
  {
    id: "preview-diagnostic",
    token: "preview-token-maria",
    profile: "EN_PROCESO",
    profileName: DIAGNOSTIC_PROFILES.EN_PROCESO.name,
    urgencyScore: 8,
    commitmentScore: 8,
    recommendedProductTitle: "Terapia 6 sesiones",
    source: "enlaces",
    completedAt: "2026-09-10T14:32:00.000Z",
    createdAt: "2026-09-10T14:18:00.000Z",
    viewedResultAt: "2026-09-10T14:33:00.000Z",
    checkoutStartedAt: "2026-09-10T14:40:00.000Z",
    whatsappLeadAt: "2026-09-10T14:40:00.000Z",
    whatsappStaffAt: "2026-09-11T10:15:00.000Z",
    isCustomer: false,
    contact: {
      id: "preview-1",
      name: "María González",
      email: "maria.gonzalez@example.com",
      phoneE164: "+34612345678",
    },
    answers: buildDiagnosticAnswers(PREVIEW_DIAGNOSTIC_ANSWERS["preview-diagnostic"]),
  },
  {
    id: "preview-diagnostic-2",
    token: "preview-token-anonimo",
    profile: "EXPLORADOR",
    profileName: DIAGNOSTIC_PROFILES.EXPLORADOR.name,
    urgencyScore: 4,
    commitmentScore: 0,
    recommendedProductTitle: "Curso en vivo",
    source: "ad",
    completedAt: "2026-09-08T09:05:00.000Z",
    createdAt: "2026-09-08T08:58:00.000Z",
    viewedResultAt: null,
    checkoutStartedAt: null,
    whatsappLeadAt: null,
    whatsappStaffAt: null,
    isCustomer: false,
    // Diagnóstico sin contacto: llegó por anuncio y no dejó datos.
    contact: null,
    answers: buildDiagnosticAnswers(PREVIEW_DIAGNOSTIC_ANSWERS["preview-diagnostic-2"]),
  },
  {
    id: "preview-diagnostic-3",
    token: "preview-token-laura",
    profile: "RAIZ_PROFUNDA",
    profileName: DIAGNOSTIC_PROFILES.RAIZ_PROFUNDA.name,
    urgencyScore: 9,
    commitmentScore: 5,
    recommendedProductTitle: "Terapia 12 sesiones",
    source: "historias",
    completedAt: "2026-08-28T19:20:00.000Z",
    createdAt: "2026-08-28T19:02:00.000Z",
    viewedResultAt: "2026-08-28T19:21:00.000Z",
    checkoutStartedAt: null,
    whatsappLeadAt: null,
    whatsappStaffAt: "2026-08-29T16:00:00.000Z",
    isCustomer: true,
    contact: {
      id: "preview-3",
      name: "Laura Martínez",
      email: null,
      phoneE164: "+12025550199",
    },
    answers: buildDiagnosticAnswers(PREVIEW_DIAGNOSTIC_ANSWERS["preview-diagnostic-3"]),
  },
];
