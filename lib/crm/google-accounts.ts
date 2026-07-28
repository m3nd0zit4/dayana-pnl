import crypto from "crypto";
import type { GoogleAccount, GoogleService } from "@prisma/client";
import { prisma } from "@/lib/db";

/**
 * Acceso a `GoogleAccount`. Todo el CRM entra por aquí (ver CLAUDE.md): las
 * rutas y las tools no tocan Prisma directamente.
 */

/**
 * Sujeto nuevo para Vercel Connect.
 *
 * Aleatorio y de un solo uso a propósito: el permiso de Google queda atado a
 * este valor, así que derivarlo del staff o del correo haría que dos cuentas
 * distintas acabaran compartiendo (o pisándose) el mismo permiso.
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
 * Fila pendiente: existe para tener un sujeto estable que darle a Connect, pero
 * `isActive` sigue en falso hasta que vuelve el consentimiento. Antes de eso no
 * representa ninguna cuenta real de Google.
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

/** Consentimiento completado: la cuenta pasa a estar operativa. */
export const activateGoogleAccount = (
  id: string,
  identity: { email: string | null; displayName: string | null; avatarUrl: string | null }
): Promise<GoogleAccount> =>
  prisma.googleAccount.update({
    where: { id },
    data: {
      email: identity.email,
      displayName: identity.displayName,
      avatarUrl: identity.avatarUrl,
      isActive: true,
      lastError: null,
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
