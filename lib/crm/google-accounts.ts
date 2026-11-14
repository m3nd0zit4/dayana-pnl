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

/**
 * Lo único que sale de este módulo. `refreshTokenEnc` (el permiso de Google,
 * cifrado), `grantedScopes` y `connectSubject` no se devuelven nunca: el token
 * solo se lee en `lib/google/connect.ts` (`load` del almacén de tokens), y así
 * no puede acabar en una respuesta JSON, el navegador o el historial de una
 * tool.
 */
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

export const getGoogleAccount = (id: string): Promise<GoogleAccountSummary | null> =>
  prisma.googleAccount.findUnique({ where: { id }, select: SUMMARY_SELECT });

/**
 * Fila pendiente: existe para que el `state` del consentimiento apunte a algo,
 * pero `isActive` sigue en falso hasta que vuelve el consentimiento. Antes de
 * eso no representa ninguna cuenta real de Google.
 */
export const createPendingGoogleAccount = (input: {
  services: GoogleService[];
  staffUserId: string;
}): Promise<GoogleAccountSummary> =>
  prisma.googleAccount.create({
    data: {
      connectSubject: newConnectSubject(),
      services: input.services,
      connectedByStaffId: input.staffUserId,
    },
    select: SUMMARY_SELECT,
  });

/**
 * Consentimiento completado: guarda el refresh token (ya cifrado), los scopes
 * que Google concedió, los servicios que quedan y quién es la cuenta.
 *
 * La pantalla de consentimiento deja desmarcar casillas, así que `services`
 * son solo los pedidos que Google concedió (lo decide el callback), y
 * `lastError` dice cuáles faltaron. Solo si no concedió ninguno queda apagada
 * (`isActive: false`): un Drive sin conceder no puede tumbar el Calendario.
 */
export const activateGoogleAccount = (
  id: string,
  input: {
    identity: { email: string | null; displayName: string | null; avatarUrl: string | null };
    refreshTokenEnc: string;
    grantedScopes: string[];
    services: GoogleService[];
    isActive: boolean;
    lastError: string | null;
  }
): Promise<GoogleAccountSummary> =>
  prisma.googleAccount.update({
    where: { id },
    data: {
      email: input.identity.email,
      displayName: input.identity.displayName,
      avatarUrl: input.identity.avatarUrl,
      refreshTokenEnc: input.refreshTokenEnc,
      grantedScopes: input.grantedScopes,
      services: input.services,
      authorizedAt: new Date(),
      isActive: input.isActive,
      lastError: input.lastError,
    },
    select: SUMMARY_SELECT,
  });

/**
 * Cambia qué servicios expone la cuenta.
 *
 * Quitar un servicio se guarda ya. Añadirlo NO: añade scopes, un permiso ya
 * concedido no los gana solo, y guardar la casilla antes de que Google la
 * conceda dejaría la cuenta diciendo que tiene Drive sin tenerlo (y si la
 * persona cancela en Google, así se quedaría). Los añadidos se devuelven en
 * `added`; la ruta pide el consentimiento con la lista entera y el callback
 * guarda solo lo que Google concedió.
 */
export const setGoogleAccountServices = async (
  id: string,
  requested: GoogleService[]
): Promise<{ account: GoogleAccountSummary; added: GoogleService[] }> => {
  const current = await prisma.googleAccount.findUnique({
    where: { id },
    select: { services: true },
  });
  if (!current) throw new Error("La cuenta de Google no existe.");

  const added = requested.filter((s) => !current.services.includes(s));
  const kept = current.services.filter((s) => requested.includes(s));
  const account = await prisma.googleAccount.update({
    where: { id },
    data: { services: kept },
    select: SUMMARY_SELECT,
  });

  return { account, added };
};

export const deleteGoogleAccount = async (id: string): Promise<void> => {
  await prisma.googleAccount.delete({ where: { id }, select: { id: true } });
};

/**
 * Cuántas cuentas hay conectadas y funcionando. Lo usa la pantalla de
 * integraciones para decir si Google está realmente en marcha o solo
 * configurado.
 */
export const countActiveGoogleAccounts = (): Promise<number> =>
  prisma.googleAccount.count({ where: { isActive: true } });
