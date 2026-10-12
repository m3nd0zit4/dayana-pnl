import { createHmac } from "node:crypto";

import { prisma } from "@/lib/db";
import { isWhatsAppUserId, whatsAppIdVariants } from "@/lib/whatsapp-contact";

/**
 * Números personales de Dayana (familia, amigos): la IA no les contesta y sus
 * chats no se importan. Del número solo se guarda una huella (HMAC con
 * AUTH_SECRET): con la tabla sola no se puede saber de quién es, pero un
 * mensaje que llega de ese número se reconoce.
 *
 * La huella es la misma para todas las formas del número (México 52/521,
 * Argentina 54/549, Brasil con y sin 9).
 */

const key = () => process.env.AUTH_SECRET?.trim() || "dayana-ignored-numbers";

/** Huella del número, igual para todas sus formas. null si no es un número. */
export const phoneHash = (phone: string): string | null => {
  if (isWhatsAppUserId(phone.trim())) return null;
  const variants = whatsAppIdVariants(phone);
  if (variants.length === 0 || variants[0].length < 8) return null;
  const canonical = [...variants].sort()[0];
  return createHmac("sha256", key()).update(`wa:${canonical}`).digest("hex");
};

export const ignoreNumbers = async (phones: string[], source: "phone_export" | "manual"): Promise<number> => {
  const hashes = [...new Set(phones.map(phoneHash).filter((h): h is string => Boolean(h)))];
  if (hashes.length === 0) return 0;
  const r = await prisma.whatsAppIgnoredNumber.createMany({
    data: hashes.map((phoneHash) => ({ phoneHash, source })),
    skipDuplicates: true,
  });
  return r.count;
};

export const unignoreNumber = async (phone: string): Promise<void> => {
  const hash = phoneHash(phone);
  if (hash) await prisma.whatsAppIgnoredNumber.deleteMany({ where: { phoneHash: hash } });
};

/** ¿Es un número personal de Dayana? Un id de usuario (BSUID) nunca lo es. */
export const isIgnoredNumber = async (threadId: string): Promise<boolean> => {
  const hash = phoneHash(threadId);
  if (!hash) return false;
  return (await prisma.whatsAppIgnoredNumber.count({ where: { phoneHash: hash } })) > 0;
};
