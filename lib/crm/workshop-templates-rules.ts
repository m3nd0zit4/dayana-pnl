import { INVITE_TEMPLATE_KEY, INVITE_TEMPLATE_TITLE } from "./workshop-invite-rules";
import { REGISTRATION_TEMPLATE_KEY, REGISTRATION_TEMPLATE_TITLE } from "./workshop-registration-rules";

/**
 * Las dos plantillas de WhatsApp del taller, a la vista en «Interesadas»
 * (pedido del 29-oct). La del registro en la página (`taller_registro_pagina`,
 * Utilidad) solo se mandaba a Meta con el primer registro de alguien que no
 * había escrito en 24 h (`workshop-registration.ts`): la aprobación ni había
 * empezado y a los primeros registros no les iba a llegar nada. La de la
 * invitación a inscritas de eventos gratuitos (`taller_invitacion_inscritas`,
 * Marketing) ya tenía su botón, pero escondido en el diálogo de la invitación.
 *
 * Ahora la dueña ve cómo está cada una en Meta (sin mandar, en revisión,
 * aprobada como Utilidad, pasada a Marketing, rechazada y por qué) y las manda
 * a aprobar de una vez (`workshop-templates.ts`). Mandarlas a revisión no
 * cuesta; Meta cobra cada mensaje enviado con ellas.
 *
 * Puro: lo usan `workshop-templates.ts`, la pantalla y las pruebas.
 */

export type WorkshopTemplateSpec = {
  key: string;
  title: string;
  /** La categoría que se le pide a Meta (la de `STARTER_TEMPLATES`). */
  category: "UTILITY" | "MARKETING";
  /** A quién le llega. */
  purpose: string;
  /** Qué pasa mientras Meta no la aprueba. */
  whileMissing: string;
  /** Qué pasa ya aprobada. */
  whenApproved: string;
};

export const WORKSHOP_TEMPLATES: WorkshopTemplateSpec[] = [
  {
    key: REGISTRATION_TEMPLATE_KEY,
    title: REGISTRATION_TEMPLATE_TITLE,
    category: "UTILITY",
    purpose: "A quien se registra en la página del taller y no escribió en las últimas 24 h.",
    whileMissing: "Mientras tanto, a esas personas no les llega el WhatsApp del registro (queda anotado en su fila).",
    whenApproved: "A quien se registra y no escribió en las últimas 24 h le llega con ella.",
  },
  {
    key: INVITE_TEMPLATE_KEY,
    title: INVITE_TEMPLATE_TITLE,
    category: "MARKETING",
    purpose: "La invitación a inscritas de eventos gratuitos que no escribieron en las últimas 24 h.",
    whileMissing: "Mientras tanto, la invitación solo les llega a quienes escribieron en las últimas 24 h.",
    whenApproved: "La invitación les llega también a quienes no escribieron en 24 h (Meta cobra cada una).",
  },
];

export const WORKSHOP_TEMPLATE_KEYS = WORKSHOP_TEMPLATES.map((t) => t.key) as [string, ...string[]];

export const workshopTemplateSpec = (key: string): WorkshopTemplateSpec | null => WORKSHOP_TEMPLATES.find((t) => t.key === key) ?? null;

/** Cómo la guarda el CRM (`MessageTemplate.metaApprovalStatus` / `metaCategory`); null = nunca se mandó. */
export type StoredTemplate = { status: string | null; category: string | null } | null;

export type WorkshopTemplateState = {
  kind: "none" | "pending" | "approved" | "marketing" | "rejected" | "paused" | "deleted";
  /** Corto, para la insignia. */
  label: string;
  /** El porqué y qué pasa, para la línea de abajo. */
  detail: string;
  tone: "ok" | "warn" | "info";
  /** Se puede mandar (otra vez) a aprobar: nunca se mandó o Meta la rechazó. */
  submittable: boolean;
};

/** El motivo de Meta (`REJECTED · INVALID_FORMAT`, `remoteStatus`) dicho en español. */
const REJECTED_REASON: Record<string, string> = {
  INVALID_FORMAT: "el formato no es válido (variables, signos o largo)",
  INCORRECT_CATEGORY: "dice que la categoría no corresponde al texto",
  TAG_CONTENT_MISMATCH: "dice que la categoría no corresponde al texto",
  PROMOTIONAL: "la ve como publicidad",
  ABUSIVE_CONTENT: "la ve como contenido no permitido",
  SCAM: "la ve como posible engaño",
};

export const rejectedReason = (status: string | null | undefined): string | null => {
  const code = (status ?? "").split("·")[1]?.trim().toUpperCase();
  if (!code || code === "NONE") return null;
  return REJECTED_REASON[code] ? `${REJECTED_REASON[code]} (${code})` : code;
};

const CATEGORY_LABEL: Record<string, string> = { UTILITY: "Utilidad", MARKETING: "Marketing", AUTHENTICATION: "Autenticación" };
const categoryLabel = (c: string | null | undefined) => (c ? (CATEGORY_LABEL[c.toUpperCase()] ?? c) : null);

/**
 * El estado de una plantilla del taller en Meta, tal como lo dejó la última
 * sincronización con 360dialog. Meta decide la categoría al aprobarla: una de
 * Utilidad que aprueba como Marketing se dice claro (la del registro no sale
 * sola así: `approvedUtilityTemplateFor`) y no se vuelve a mandar (el nombre
 * ya está tomado; se revisa en WhatsApp → Plantillas).
 */
export const workshopTemplateState = (spec: WorkshopTemplateSpec, t: StoredTemplate): WorkshopTemplateState => {
  const status = (t?.status ?? "").trim().toUpperCase();
  if (!t || !status) {
    return { kind: "none", label: "Sin mandar a Meta", detail: `Todavía no se ha mandado a aprobar. ${spec.whileMissing}`, tone: "warn", submittable: true };
  }
  if (status === "APPROVED") {
    const got = (t.category ?? "").toUpperCase();
    if (spec.category === "UTILITY" && got && got !== "UTILITY") {
      return {
        kind: "marketing",
        label: `Meta la pasó a ${categoryLabel(got)}`,
        detail: `Se pidió como Utilidad y Meta la aprobó como ${categoryLabel(got)}: no se envía sola. Revísala en WhatsApp → Plantillas.`,
        tone: "warn",
        submittable: false,
      };
    }
    return {
      kind: "approved",
      label: got ? `Aprobada como ${categoryLabel(got)}` : "Aprobada",
      detail: spec.whenApproved,
      tone: "ok",
      submittable: false,
    };
  }
  if (status.startsWith("REJECTED")) {
    const why = rejectedReason(t.status);
    return {
      kind: "rejected",
      label: "Rechazada por Meta",
      detail: `${why ? `Meta ${why}. ` : ""}Puedes mandarla otra vez a aprobar. ${spec.whileMissing}`,
      tone: "warn",
      submittable: true,
    };
  }
  if (status === "DELETED") {
    return {
      kind: "deleted",
      label: "Quitada de WhatsApp",
      detail: "Se quitó de WhatsApp; Meta no deja volver a usar el nombre por 30 días. Revísala en WhatsApp → Plantillas.",
      tone: "warn",
      submittable: false,
    };
  }
  if (["PAUSED", "DISABLED", "FLAGGED"].includes(status)) {
    return {
      kind: "paused",
      label: status === "DISABLED" ? "Desactivada por Meta" : "Pausada por Meta",
      detail: `Meta la ${status === "DISABLED" ? "desactivó" : "pausó"} (suele ser por respuestas negativas): no se envía. Revísala en WhatsApp → Plantillas.`,
      tone: "warn",
      submittable: false,
    };
  }
  // PENDING, IN_APPEAL, PENDING_DELETION… (lo que dice 360dialog mientras la revisan).
  return {
    kind: "pending",
    label: "En revisión de Meta",
    detail: `Meta la está revisando (suele tardar de minutos a un día; el CRM pregunta solo). ${spec.whileMissing}`,
    tone: "info",
    submittable: false,
  };
};
