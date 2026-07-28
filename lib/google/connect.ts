import {
  getToken,
  getTokenResponse,
  startAuthorization,
  NoValidTokenError,
  UserAuthorizationRequiredError,
} from "@vercel/connect";
import type { GoogleService } from "@prisma/client";
import { prisma } from "@/lib/db";

/**
 * Único punto que habla con Vercel Connect.
 *
 * Connect guarda el refresh token de Google en su infraestructura; aquí nunca
 * pasa un token de larga vida. `getAccountToken` pide un access token corto en
 * cada llamada y el SDK cachea en proceso hasta que está por caducar.
 *
 * Varias cuentas de Google salen de dar un **sujeto distinto** a cada una
 * (`GoogleAccount.connectSubject`): los conectores OAuth propios de Connect no
 * soportan instalaciones multi-tenant, así que el sujeto es la única dimensión
 * por la que se pueden separar dos permisos del mismo conector.
 */

export const GOOGLE_CONNECTOR_ENV = "GOOGLE_CONNECT_CONNECTOR";

/** UID del conector (`vercel connect create` → p. ej. `oauth/google`). */
export const googleConnectorUid = (): string | null =>
  process.env[GOOGLE_CONNECTOR_ENV]?.trim() || null;

export const isGoogleEnabled = (): boolean => googleConnectorUid() != null;

/**
 * Scopes de identidad: no habilitan ningún servicio, solo permiten etiquetar la
 * cuenta con su correo en la UI. Sin esto la lista de cuentas conectadas serían
 * ids opacos y el operador no sabría cuál es cuál.
 */
const IDENTITY_SCOPES = [
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
};

export const scopesForServices = (services: readonly GoogleService[]): string[] => [
  ...IDENTITY_SCOPES,
  ...services.flatMap((service) => SERVICE_SCOPES[service]),
];

/** Nombres legibles para la UI y para lo que el agente le dice al operador. */
export const SERVICE_LABELS: Record<GoogleService, string> = {
  CALENDAR: "Calendario",
  CONTACTS: "Contactos",
  DRIVE: "Drive",
};

export class GoogleNotConfiguredError extends Error {
  constructor() {
    super(
      `Google no está configurado: falta ${GOOGLE_CONNECTOR_ENV}. Se define tras crear el conector con \`vercel connect create\`.`
    );
  }
}

/** La cuenta existe pero hay que volver a pasar por el consentimiento. */
export class GoogleReauthorizationRequiredError extends Error {
  constructor(public readonly accountId: string, message?: string) {
    super(
      message ??
        "La cuenta de Google ya no está autorizada. Vuelve a conectarla en /admin/ajustes/google."
    );
  }
}

const requireConnector = (): string => {
  const uid = googleConnectorUid();
  if (!uid) throw new GoogleNotConfiguredError();
  return uid;
};

/**
 * Arranca el consentimiento de una cuenta y devuelve la URL a la que mandar el
 * navegador.
 *
 * `callbackUrl` hace que Connect devuelva al usuario a nuestra página cuando
 * termina, así que el flujo se cierra con una redirección normal y no hay que
 * sondear. Acepta https y http://localhost, de modo que también funciona en
 * desarrollo.
 */
export const startAccountAuthorization = async (input: {
  connectSubject: string;
  services: readonly GoogleService[];
  callbackUrl: string;
}): Promise<string> => {
  const { url } = await startAuthorization(
    requireConnector(),
    {
      subject: { type: "user", id: input.connectSubject },
      scopes: scopesForServices(input.services),
    },
    { callbackUrl: input.callbackUrl }
  );
  return url;
};

/**
 * Marca la cuenta como caída y devuelve el error que corresponde.
 *
 * Mismo criterio que `lib/tiktok/oauth.ts`: un permiso revocado no es un fallo
 * pasajero, así que la fila se apaga y la UI ofrece reconectar en vez de dejar
 * al operador reintentando algo que nunca va a funcionar.
 */
const markNeedsReauthorization = async (accountId: string, reason: string) => {
  await prisma.googleAccount.update({
    where: { id: accountId },
    data: { isActive: false, lastError: reason },
  });
  return new GoogleReauthorizationRequiredError(accountId);
};

const needsReauthorization = (error: unknown): boolean =>
  error instanceof UserAuthorizationRequiredError ||
  error instanceof NoValidTokenError;

/**
 * Access token válido para una cuenta conectada.
 *
 * Pide solo los scopes de los servicios que esa cuenta tiene activados, no
 * todos: un token de Calendario no debería poder tocar Contactos.
 */
export const getAccountToken = async (accountId: string): Promise<string> => {
  const account = await prisma.googleAccount.findUnique({
    where: { id: accountId },
  });
  if (!account) throw new Error("La cuenta de Google no existe.");
  if (!account.isActive) throw new GoogleReauthorizationRequiredError(accountId);

  try {
    return await getToken(requireConnector(), {
      subject: { type: "user", id: account.connectSubject },
      scopes: scopesForServices(account.services),
    });
  } catch (error) {
    if (needsReauthorization(error)) {
      throw await markNeedsReauthorization(
        accountId,
        error instanceof Error ? error.message : "authorization_required"
      );
    }
    throw error;
  }
};

export type GoogleAccountIdentity = {
  email: string | null;
  displayName: string | null;
  avatarUrl: string | null;
};

/**
 * Comprueba si el consentimiento ya se completó y, de paso, resuelve quién es.
 *
 * `externalSubject` de Connect es el id de Google, estable pero ilegible, así
 * que el correo se pide a userinfo con el propio token. Si esa llamada falla la
 * cuenta queda conectada igual: perder la etiqueta es cosmético, perder la
 * conexión no.
 */
export const resolveAccountIdentity = async (
  connectSubject: string,
  services: readonly GoogleService[]
): Promise<GoogleAccountIdentity> => {
  const response = await getTokenResponse(requireConnector(), {
    subject: { type: "user", id: connectSubject },
    scopes: scopesForServices(services),
  });

  try {
    const res = await fetch(
      "https://www.googleapis.com/oauth2/v3/userinfo",
      { headers: { Authorization: `Bearer ${response.token}` } }
    );
    if (!res.ok) throw new Error(`userinfo HTTP ${res.status}`);
    const info = (await res.json()) as {
      email?: string;
      name?: string;
      picture?: string;
    };
    return {
      email: info.email ?? null,
      displayName: info.name ?? null,
      avatarUrl: info.picture ?? null,
    };
  } catch {
    return { email: null, displayName: response.name ?? null, avatarUrl: null };
  }
};

export { UserAuthorizationRequiredError, NoValidTokenError };
