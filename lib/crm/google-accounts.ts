import crypto from "crypto";
import type { GoogleAccount, GoogleService } from "@prisma/client";
import { prisma } from "@/lib/db";

/**
 * Acceso a `GoogleAccount`. Todo el CRM entra por aquí (ver CLAUDE.md): las
 * rutas y las tools no tocan Prisma directamente.
 */

/**
 * Identificador opaco y único de la fila (`connectSubject`).
 *
 * Nació como el sujeto de Vercel Connect; con el OAuth directo ya no se le
 * pasa a nadie, pero la columna es única y obligatoria, así que se sigue
 * rellenando con un valor aleatorio.
 */
const newConnectSubject = (): string =>
  `google:${crypto.randomBytes(16).toString("hex")}`;

export type GoogleAccountSummary = Pick<
  GoogleAccount,
  | "id"
  | "email"
  | "displayName"
  | "avatarUrl"
  | "services"
  | "isActive"
  | "lastError"
  | "createdAt"
>;

const SUMMARY_SELECT = {
  id: true,
  email: true,
  displayName: true,
  avatarUrl: true,
  services: true,
  isActive: true,
  lastError: true,
  createdAt: true,
} as const;

export const listGoogleAccounts = (): Promise<GoogleAccountSummary[]> =>
  prisma.googleAccount.findMany({
    select: SUMMARY_SELECT,
    orderBy: [{ isActive: "desc" }, { createdAt: "asc" }],
  });

/**
 * Cuentas vivas que exponen un servicio concreto.
 *
 * Es lo que usan las tools para decidir con qué cuenta trabajar cuando el
 * operador no dice ninguna.
 */
export const listActiveGoogleAccountsForService = (
  service: GoogleService
): Promise<GoogleAccountSummary[]> =>
  prisma.googleAccount.findMany({
    where: { isActive: true, services: { has: service } },
    select: SUMMARY_SELECT,
    orderBy: { createdAt: "asc" },
  });

export const getGoogleAccount = (id: string): Promise<GoogleAccount | null> =>
  prisma.googleAccount.findUnique({ where: { id } });

/**
 * Fila pendiente: existe para que el `state` del consentimiento apunte a algo,
 * pero `isActive` sigue en falso hasta que vuelve el consentimiento. Antes de
 * eso no representa ninguna cuenta real de Google.
 */
export const createPendingGoogleAccount = (input: {
  services: GoogleService[];
  staffUserId: string;
}): Promise<GoogleAccount> =>
  prisma.googleAccount.create({
    data: {
      connectSubject: newConnectSubject(),
      services: input.services,
      connectedByStaffId: input.staffUserId,
    },
  });

/**
 * Consentimiento completado: guarda el refresh token (ya cifrado), los scopes
 * que Google concedió y quién es la cuenta.
 *
 * `missingServices` son los servicios marcados cuyos permisos Google no dio
 * (la pantalla de consentimiento deja desmarcar casillas): entonces la cuenta
 * queda guardada pero apagada, con el motivo a la vista, en vez de decir que
 * tiene Calendario y fallar en la primera cita.
 */
export const activateGoogleAccount = (
  id: string,
  input: {
    identity: { email: string | null; displayName: string | null; avatarUrl: string | null };
    refreshTokenEnc: string;
    grantedScopes: string[];
    missingReason?: string | null;
  }
): Promise<GoogleAccount> =>
  prisma.googleAccount.update({
    where: { id },
    data: {
      email: input.identity.email,
      displayName: input.identity.displayName,
      avatarUrl: input.identity.avatarUrl,
      refreshTokenEnc: input.refreshTokenEnc,
      grantedScopes: input.grantedScopes,
      authorizedAt: new Date(),
      isActive: !input.missingReason,
      lastError: input.missingReason ?? null,
    },
  });

/**
 * Cambia qué servicios expone la cuenta.
 *
 * Añadir un servicio añade scopes, y un permiso ya concedido no los gana solo,
 * así que en ese caso hay que volver a pasar por el consentimiento — de ahí
 * `needsReauthorization`, que la ruta traduce en una URL nueva.
 */
export const setGoogleAccountServices = async (
  id: string,
  services: GoogleService[]
): Promise<{ account: GoogleAccount; needsReauthorization: boolean }> => {
  const current = await prisma.googleAccount.findUnique({ where: { id } });
  if (!current) throw new Error("La cuenta de Google no existe.");

  const added = services.filter((s) => !current.services.includes(s));
  const account = await prisma.googleAccount.update({
    where: { id },
    data: { services },
  });

  return { account, needsReauthorization: added.length > 0 };
};

export const deleteGoogleAccount = (id: string): Promise<GoogleAccount> =>
  prisma.googleAccount.delete({ where: { id } });

/**
 * Cuántas cuentas hay conectadas y funcionando. Lo usa la pantalla de
 * integraciones para decir si Google está realmente en marcha o solo
 * configurado.
 */
export const countActiveGoogleAccounts = (): Promise<number> =>
  prisma.googleAccount.count({ where: { isActive: true } });
