import { randomUUID } from "node:crypto";

import { prisma } from "@/lib/db";
import { ContactSource } from "@prisma/client";

/**
 * Palabras clave de redes: «comenta ÉXITO y te mando el material».
 *
 * TikTok no deja automatizar ni el comentario ni el mensaje directo (no hay
 * API pública para ninguno de los dos), así que la respuesta la pega una
 * persona con el texto que guarda cada palabra. Lo demás sí es automático:
 * quien abre `/material/<palabra>` deja su nombre y su correo, ve el material
 * al instante, le llega por correo y queda en el CRM como lead con la palabra
 * que usó.
 */

/** Teléfono provisional de un lead que solo dejó nombre y correo. */
export const MAGNET_PLACEHOLDER_PHONE_PREFIX = "+nophone";

/**
 * «ÉXITO», «Exito» y « exito » son la misma palabra. También es el tramo de
 * la URL, así que fuera todo lo que no sea letra, número o guion.
 */
export const normalizeKeyword = (raw: string): string =>
  raw
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

export type PublicMagnet = {
  id: string;
  keyword: string;
  label: string;
  title: string;
  description: string | null;
  deliveryUrl: string;
};

/** La palabra tal como la ve quien llega del video. `null` si no existe o está apagada. */
export const getActiveMagnet = async (
  rawKeyword: string
): Promise<PublicMagnet | null> => {
  const keyword = normalizeKeyword(rawKeyword);
  if (!keyword) return null;
  const magnet = await prisma.keywordMagnet.findUnique({
    where: { keyword },
    select: {
      id: true,
      keyword: true,
      label: true,
      title: true,
      description: true,
      deliveryUrl: true,
      isActive: true,
    },
  });
  if (!magnet || !magnet.isActive) return null;
  const { isActive: _isActive, ...rest } = magnet;
  return rest;
};

/** Las palabras vivas, para la página que pregunta «¿cuál te dijeron?». */
export const listActiveMagnets = async (): Promise<PublicMagnet[]> =>
  prisma.keywordMagnet.findMany({
    where: { isActive: true },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      keyword: true,
      label: true,
      title: true,
      description: true,
      deliveryUrl: true,
    },
  });

const CONTACT_SOURCE: Record<string, ContactSource> = {
  tiktok: ContactSource.TIKTOK,
  instagram: ContactSource.INSTAGRAM,
  youtube: ContactSource.YOUTUBE,
};

/**
 * Ficha del lead a partir de nombre + correo.
 *
 * `Contact.email` es único, así que quien ya está en el CRM se reutiliza tal
 * cual: pedir el material no puede duplicar a una clienta ni pisarle el
 * teléfono real con uno provisional. Quien es nuevo entra con el mismo
 * teléfono provisional que usan los enlaces de pago sin número.
 */
const resolveLeadContact = async (input: {
  email: string;
  firstName: string;
  source: string | null;
  keywordLabel: string;
}): Promise<string> => {
  const existing = await prisma.contact.findUnique({
    where: { email: input.email },
    select: { id: true, firstName: true },
  });
  if (existing) {
    // Solo se rellena lo que falta: un nombre escrito a la carrera en un
    // formulario no debe pisar el que ya está en su ficha.
    if (!existing.firstName || existing.firstName === input.email) {
      await prisma.contact.update({
        where: { id: existing.id },
        data: { firstName: input.firstName },
      });
    }
    return existing.id;
  }

  const created = await prisma.contact.create({
    data: {
      phoneE164: `${MAGNET_PLACEHOLDER_PHONE_PREFIX}:${randomUUID()}`,
      firstName: input.firstName,
      email: input.email,
      source: (input.source ? CONTACT_SOURCE[input.source] : undefined) ?? ContactSource.WEB,
      sourceDetail: `material: ${input.keywordLabel}`,
    },
    select: { id: true },
  });
  return created.id;
};

export type ClaimResult = {
  magnet: PublicMagnet;
  claimId: string;
  contactId: string;
  /** `false` cuando ya lo había pedido antes: el material se entrega igual. */
  isNew: boolean;
};

/**
 * Registra que alguien pidió el material y devuelve con qué entregarlo.
 *
 * Idempotente por (palabra, correo): volver a pedirlo desde otro dispositivo
 * abre el material otra vez sin crear un segundo lead ni mandar otro correo.
 */
export const claimMagnet = async (input: {
  keyword: string;
  email: string;
  firstName: string;
  source?: string | null;
}): Promise<ClaimResult | null> => {
  const magnet = await getActiveMagnet(input.keyword);
  if (!magnet) return null;

  const email = input.email.trim().toLowerCase();
  const firstName = input.firstName.trim();

  const contactId = await resolveLeadContact({
    email,
    firstName,
    source: input.source ?? null,
    keywordLabel: magnet.label,
  });

  const existing = await prisma.magnetClaim.findUnique({
    where: { magnetId_email: { magnetId: magnet.id, email } },
    select: { id: true },
  });
  if (existing) {
    return { magnet, claimId: existing.id, contactId, isNew: false };
  }

  const claim = await prisma.magnetClaim.create({
    data: {
      magnetId: magnet.id,
      contactId,
      email,
      firstName,
      source: input.source ?? null,
    },
    select: { id: true },
  });

  return { magnet, claimId: claim.id, contactId, isNew: true };
};

/** Sella que el correo con el material salió. Nunca lanza: ya se entregó en pantalla. */
export const markClaimEmailSent = async (claimId: string): Promise<void> => {
  try {
    await prisma.magnetClaim.update({
      where: { id: claimId },
      data: { emailSentAt: new Date() },
    });
  } catch (e) {
    console.error("[magnets] no se pudo sellar el correo del material", e);
  }
};

export type MagnetAdminRow = {
  id: string;
  keyword: string;
  label: string;
  title: string;
  description: string | null;
  deliveryUrl: string;
  replyText: string | null;
  dmText: string | null;
  isActive: boolean;
  createdAt: Date;
  claimCount: number;
  /** Cuántos lo pidieron en los últimos 7 días: si el video tira o no. */
  claimCount7d: number;
};

export const listMagnetsForAdmin = async (): Promise<MagnetAdminRow[]> => {
  const magnets = await prisma.keywordMagnet.findMany({
    orderBy: [{ isActive: "desc" }, { createdAt: "desc" }],
    select: {
      id: true,
      keyword: true,
      label: true,
      title: true,
      description: true,
      deliveryUrl: true,
      replyText: true,
      dmText: true,
      isActive: true,
      createdAt: true,
      _count: { select: { claims: true } },
    },
  });
  if (magnets.length === 0) return [];

  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const recent = await prisma.magnetClaim.groupBy({
    by: ["magnetId"],
    where: { magnetId: { in: magnets.map((m) => m.id) }, createdAt: { gte: since } },
    _count: { _all: true },
  });
  const recentByMagnet = new Map(recent.map((r) => [r.magnetId, r._count._all]));

  return magnets.map(({ _count, ...m }) => ({
    ...m,
    claimCount: _count.claims,
    claimCount7d: recentByMagnet.get(m.id) ?? 0,
  }));
};

export type MagnetInput = {
  keyword: string;
  label?: string | null;
  title: string;
  description?: string | null;
  deliveryUrl: string;
  replyText?: string | null;
  dmText?: string | null;
  isActive?: boolean;
};

/** Lanza `KEYWORD_TAKEN` si otra palabra ya usa esa misma. */
export const createMagnet = async (input: MagnetInput) => {
  const keyword = normalizeKeyword(input.keyword);
  const clash = await prisma.keywordMagnet.findUnique({
    where: { keyword },
    select: { id: true },
  });
  if (clash) throw new Error("KEYWORD_TAKEN");

  return prisma.keywordMagnet.create({
    data: {
      keyword,
      label: input.label?.trim() || input.keyword.trim(),
      title: input.title.trim(),
      description: input.description?.trim() || null,
      deliveryUrl: input.deliveryUrl.trim(),
      replyText: input.replyText?.trim() || null,
      dmText: input.dmText?.trim() || null,
      isActive: input.isActive ?? true,
    },
  });
};

export const updateMagnet = async (id: string, input: MagnetInput) => {
  const keyword = normalizeKeyword(input.keyword);
  const clash = await prisma.keywordMagnet.findFirst({
    where: { keyword, NOT: { id } },
    select: { id: true },
  });
  if (clash) throw new Error("KEYWORD_TAKEN");

  return prisma.keywordMagnet.update({
    where: { id },
    data: {
      keyword,
      label: input.label?.trim() || input.keyword.trim(),
      title: input.title.trim(),
      description: input.description?.trim() || null,
      deliveryUrl: input.deliveryUrl.trim(),
      replyText: input.replyText?.trim() || null,
      dmText: input.dmText?.trim() || null,
      ...(input.isActive === undefined ? {} : { isActive: input.isActive }),
    },
  });
};

/**
 * Borra la palabra. Los leads que ya la pidieron se van con ella (`Cascade`),
 * pero sus fichas no: el contacto es del CRM, no del material.
 */
export const deleteMagnet = async (id: string): Promise<void> => {
  await prisma.keywordMagnet.delete({ where: { id } });
};

export const listClaimsForMagnet = async (magnetId: string, take = 50) =>
  prisma.magnetClaim.findMany({
    where: { magnetId },
    orderBy: { createdAt: "desc" },
    take,
    select: {
      id: true,
      email: true,
      firstName: true,
      source: true,
      emailSentAt: true,
      createdAt: true,
      contactId: true,
    },
  });
