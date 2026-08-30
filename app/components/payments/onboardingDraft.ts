"use client";

/**
 * Borrador del alta de cuenta previa al pago.
 *
 * Crear la cuenta son cuatro pasos, y perderlos por refrescar, cambiar de
 * pestaña o volver atrás es motivo suficiente para abandonar una compra que ya
 * estaba decidida. Se guarda lo tecleado y por qué paso iba.
 *
 * ## Dos decisiones deliberadas
 *
 * **Las contraseñas NO se guardan.** Ni la principal ni la confirmación. Dejar
 * una contraseña en el almacenamiento del navegador es un riesgo real —queda a
 * la vista de cualquiera con acceso al equipo, y de cualquier script de la
 * página— y no compensa ahorrar un campo. Al volver, ese paso se rellena de
 * nuevo.
 *
 * **`sessionStorage`, no `localStorage`.** Cubre lo que hace falta —refrescar,
 * irse y volver, cambiar de pestaña— y se borra al cerrar. En un ordenador
 * compartido, el nombre y el teléfono de alguien no deberían quedarse ahí para
 * siempre.
 */

export type OnboardingDraft = {
  /**
   * @deprecated El alta dejó de ser multipaso. Se mantiene en el tipo para que
   * un borrador guardado por la versión anterior no rompa `loadDraft`.
   */
  step?: number;
  email?: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
  phoneCountry?: string;
  consent?: boolean;
  /** Estado del overlay para poder reabrirlo donde estaba. */
  provider?: "paypal" | "mercadopago";
  mode?: "wizard" | "login";
};

const key = (planId: string) => `dbpnl:checkout-onboarding:${planId}`;

export const loadDraft = (planId: string): OnboardingDraft | null => {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(key(planId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    return parsed as OnboardingDraft;
  } catch {
    // Modo incógnito estricto, almacenamiento lleno o JSON corrupto: se
    // empieza de cero. Nunca puede tumbar el checkout.
    return null;
  }
};

export const saveDraft = (planId: string, draft: OnboardingDraft): void => {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(key(planId), JSON.stringify(draft));
  } catch {
    /* sin almacenamiento: se sigue sin guardar */
  }
};

export const mergeDraft = (
  planId: string,
  patch: OnboardingDraft
): void => {
  saveDraft(planId, { ...(loadDraft(planId) ?? {}), ...patch });
};

/** Se llama al completar el alta o al cerrar a propósito con la ✕. */
export const clearDraft = (planId: string): void => {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(key(planId));
  } catch {
    /* nada que limpiar */
  }
};
