import type { GoogleService } from "@prisma/client";

/**
 * Scopes de Google por servicio. Módulo puro (sin Prisma ni red) para que el
 * flujo OAuth y los tests lo compartan.
 */

/**
 * Scopes de identidad: no habilitan ningún servicio, solo permiten etiquetar la
 * cuenta con su correo en la UI. Sin esto la lista de cuentas conectadas serían
 * ids opacos y el operador no sabría cuál es cuál.
 */
export const IDENTITY_SCOPES = [
  "openid",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
];

/**
 * Scopes por servicio.
 *
 * Los tres son *sensibles*, no *restringidos*: piden verificación de Google
 * pero no la evaluación de seguridad anual (CASA). Drive se queda a propósito
 * en `drive.file`, que solo ve lo que la propia app crea — `drive.readonly` sí
 * es restringido y arrastra la evaluación completa.
 */
export const SERVICE_SCOPES: Record<GoogleService, string[]> = {
  CALENDAR: ["https://www.googleapis.com/auth/calendar.events"],
  CONTACTS: ["https://www.googleapis.com/auth/contacts.readonly"],
  DRIVE: ["https://www.googleapis.com/auth/drive.file"],
  // Quién entró a una reunión (el aviso de sesión sin asistir). Sensible.
  MEET: ["https://www.googleapis.com/auth/meetings.space.readonly"],
};

export const scopesForServices = (services: readonly GoogleService[]): string[] => [
  ...IDENTITY_SCOPES,
  ...services.flatMap((service) => SERVICE_SCOPES[service]),
];

/** Scopes de servicio que pide `services` y que Google no concedió. */
export const missingServiceScopes = (
  services: readonly GoogleService[],
  granted: readonly string[]
): string[] => {
  const have = new Set(granted);
  return services
    .flatMap((service) => SERVICE_SCOPES[service])
    .filter((scope) => !have.has(scope));
};

/** Servicios de `services` cuyos scopes no están todos en `granted`. */
export const servicesMissingScopes = (
  services: readonly GoogleService[],
  granted: readonly string[]
): GoogleService[] =>
  services.filter((service) => missingServiceScopes([service], granted).length > 0);

/** Nombres legibles para la UI y para lo que el agente le dice al operador. */
export const SERVICE_LABELS: Record<GoogleService, string> = {
  CALENDAR: "Calendario",
  CONTACTS: "Contactos",
  DRIVE: "Drive",
  MEET: "Meet",
};

/**
 * Qué queda de un consentimiento: de los servicios pedidos, los que Google
 * concedió (`granted`) y los que no (`missing`). La pantalla de Google deja
 * desmarcar casillas, así que puede ser cualquier mezcla.
 */
export const splitGrantedServices = (
  requested: readonly GoogleService[],
  grantedScopes: readonly string[]
): { granted: GoogleService[]; missing: GoogleService[] } => {
  const missing = servicesMissingScopes(requested, grantedScopes);
  return { granted: requested.filter((s) => !missing.includes(s)), missing };
};
