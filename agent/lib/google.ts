import type { GoogleService } from "@prisma/client";
import {
  getGoogleAccount,
  listActiveGoogleAccountsForService,
  type GoogleAccountSummary,
} from "@/lib/crm/google-accounts";
import { getAccountToken, SERVICE_LABELS } from "@/lib/google/connect";

/**
 * Cómo eligen cuenta las tools de Google.
 *
 * Puede haber varias cuentas conectadas y el modelo no tiene forma de saber
 * cuál quiere el operador. La regla es la misma que ya usa
 * `link_conversation_to_contact` con las identidades ambiguas: si hay una sola
 * candidata se usa; si hay varias no se adivina, se devuelve la lista y se
 * pregunta.
 */

export class GoogleAccountAmbiguousError extends Error {
  constructor(
    service: GoogleService,
    public readonly accounts: GoogleAccountSummary[]
  ) {
    super(
      `Hay ${accounts.length} cuentas de Google con ${SERVICE_LABELS[service]} conectado: ${accounts
        .map((a) => `${a.email ?? a.displayName ?? a.id} (accountId: ${a.id})`)
        .join(", ")}. Pregunta al operador cuál usar y vuelve a llamar con accountId.`
    );
  }
}

export class GoogleServiceUnavailableError extends Error {
  constructor(service: GoogleService) {
    super(
      `Ninguna cuenta de Google tiene ${SERVICE_LABELS[service]} conectado. Se activa en /admin/ajustes/google. No hay forma de suplirlo con otra herramienta.`
    );
  }
}

/**
 * Resuelve la cuenta a usar y devuelve un token listo.
 *
 * Que el token se pida aquí y no se pase entre tools es deliberado: dura pocos
 * minutos y no debe acabar nunca en el historial de la conversación, que es
 * exactamente lo que pasaría si fuera parte de la entrada o la salida de una
 * tool.
 */
export const resolveGoogleAccount = async (
  service: GoogleService,
  accountId?: string
): Promise<{ account: GoogleAccountSummary; token: string }> => {
  if (accountId) {
    const explicit = await getGoogleAccount(accountId);
    if (!explicit) throw new Error("Esa cuenta de Google no existe.");
    if (!explicit.services.includes(service)) {
      throw new Error(
        `Esa cuenta no tiene ${SERVICE_LABELS[service]} activado. Actívalo en /admin/ajustes/google o usa otra cuenta.`
      );
    }
    return {
      account: explicit,
      token: await getAccountToken(explicit.id),
    };
  }

  const candidates = await listActiveGoogleAccountsForService(service);
  if (candidates.length === 0) throw new GoogleServiceUnavailableError(service);
  if (candidates.length > 1) {
    throw new GoogleAccountAmbiguousError(service, candidates);
  }

  return {
    account: candidates[0],
    token: await getAccountToken(candidates[0].id),
  };
};

/** Etiqueta corta de la cuenta, para que la respuesta diga sobre cuál actuó. */
export const accountLabel = (account: GoogleAccountSummary): string =>
  account.email ?? account.displayName ?? account.id;
