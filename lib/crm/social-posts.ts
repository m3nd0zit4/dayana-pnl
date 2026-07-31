import type { Prisma, SocialPostStatus } from "@prisma/client";
import { prisma } from "../db";
import { writeAuditLog } from "./audit";
import { resolveTiktokAudited } from "../tiktok/resolve-flags";

/**
 * Programación y estado de las publicaciones en redes.
 *
 * Igual que el resto de `lib/crm/`, las rutas de API nunca tocan Prisma
 * directamente.
 */

export const PRIVACY_LEVELS = [
  "PUBLIC_TO_EVERYONE",
  "MUTUAL_FOLLOW_FRIENDS",
  "FOLLOWER_OF_CREATOR",
  "SELF_ONLY",
] as const;

export type PrivacyLevel = (typeof PRIVACY_LEVELS)[number];

/**
 * Sin auditoría de TikTok, cualquier visibilidad distinta de SELF_ONLY es
 * rechazada al publicar. Se fuerza aquí para que el fallo no aparezca media
 * hora después, cuando salte el cron, sino al guardar.
 */
export const enforcePrivacyLevel = async (
  requested: string
): Promise<PrivacyLevel> => {
  const level = (PRIVACY_LEVELS as readonly string[]).includes(requested)
    ? (requested as PrivacyLevel)
    : "SELF_ONLY";
  return (await resolveTiktokAudited()) ? level : "SELF_ONLY";
};

/**
 * Cuentas conectadas, con la caducidad ya en días.
 *
 * El cálculo vive aquí y no en el componente porque `Date.now()` dentro de un
 * render es impuro: en el servidor y en el cliente da valores distintos.
 */
export const listSocialAccounts = async () => {
  const rows = await prisma.socialAccount.findMany({
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      provider: true,
      displayName: true,
      username: true,
      avatarUrl: true,
      isActive: true,
      lastError: true,
      expiresAt: true,
      createdAt: true,
    },
  });

  const now = Date.now();
  return rows.map((row) => ({
    ...row,
    expiresInDays: row.expiresAt
      ? Math.floor((row.expiresAt.getTime() - now) / 86_400_000)
      : null,
  }));
};

export type CreatePostInput = {
  accountId: string;
  caption?: string | null;
  mediaUrls: string[];
  privacyLevel: string;
  scheduledAt?: Date | null;
  disableComment?: boolean;
  disableDuet?: boolean;
  disableStitch?: boolean;
  staffUserId: string;
};

export const createSocialPost = async (input: CreatePostInput) => {
  if (input.mediaUrls.length === 0) {
    throw new Error("Hace falta al menos un archivo para publicar.");
  }

  const post = await prisma.socialPost.create({
    data: {
      accountId: input.accountId,
      caption: input.caption ?? null,
      mediaUrls: input.mediaUrls as unknown as Prisma.InputJsonValue,
      privacyLevel: await enforcePrivacyLevel(input.privacyLevel),
      scheduledAt: input.scheduledAt ?? null,
      // Sin fecha queda en borrador; con fecha entra a la cola del cron.
      status: input.scheduledAt ? "SCHEDULED" : "DRAFT",
      disableComment: input.disableComment ?? false,
      disableDuet: input.disableDuet ?? false,
      disableStitch: input.disableStitch ?? false,
      createdByStaffId: input.staffUserId,
    },
    select: { id: true, status: true, scheduledAt: true },
  });

  await writeAuditLog({
    staffUserId: input.staffUserId,
    action: "SOCIAL_POST_CREATED",
    entityType: "SocialPost",
    entityId: post.id,
    changes: {
      accountId: input.accountId,
      scheduledAt: input.scheduledAt?.toISOString() ?? null,
    },
  });

  return post;
};

export const listSocialPosts = (filters: { status?: SocialPostStatus } = {}) =>
  prisma.socialPost.findMany({
    where: filters.status ? { status: filters.status } : {},
    orderBy: [{ scheduledAt: "asc" }, { createdAt: "desc" }],
    take: 100,
    include: {
      account: { select: { id: true, provider: true, username: true, displayName: true } },
      createdByStaff: { select: { id: true, displayName: true } },
    },
  });

export const getSocialPost = (id: string) =>
  prisma.socialPost.findUnique({
    where: { id },
    include: { account: { select: { id: true, provider: true, isActive: true } } },
  });

export type UpdatePostInput = {
  caption?: string | null;
  privacyLevel?: string;
  scheduledAt?: Date | null;
  disableComment?: boolean;
  disableDuet?: boolean;
  disableStitch?: boolean;
};

/**
 * Edita una publicación que todavía no salió.
 *
 * El `where` incluye el estado a propósito: PUBLISHING ya está en vuelo y
 * PUBLISHED es irreversible, así que editarlas cambiaría un registro que ya no
 * describe lo que se envió.
 */
export const updateSocialPost = async (
  id: string,
  input: UpdatePostInput,
  staffUserId: string
) => {
  const privacyLevel =
    input.privacyLevel !== undefined
      ? await enforcePrivacyLevel(input.privacyLevel)
      : undefined;

  const updated = await prisma.socialPost.updateMany({
    where: { id, status: { in: ["DRAFT", "SCHEDULED", "FAILED"] } },
    data: {
      ...(input.caption !== undefined ? { caption: input.caption } : {}),
      ...(privacyLevel !== undefined ? { privacyLevel } : {}),
      ...(input.scheduledAt !== undefined
        ? {
            scheduledAt: input.scheduledAt,
            // Poner fecha la mete en la cola; quitarla la devuelve a borrador.
            status: input.scheduledAt ? "SCHEDULED" : "DRAFT",
          }
        : {}),
      ...(input.disableComment !== undefined
        ? { disableComment: input.disableComment }
        : {}),
      ...(input.disableDuet !== undefined
        ? { disableDuet: input.disableDuet }
        : {}),
      ...(input.disableStitch !== undefined
        ? { disableStitch: input.disableStitch }
        : {}),
    },
  });

  if (updated.count === 0) {
    throw new Error("Esa publicación ya no se puede editar.");
  }

  await writeAuditLog({
    staffUserId,
    action: "SOCIAL_POST_UPDATED",
    entityType: "SocialPost",
    entityId: id,
    changes: {
      ...input,
      scheduledAt: input.scheduledAt?.toISOString() ?? input.scheduledAt,
    },
  });

  return { id };
};

export const cancelSocialPost = async (id: string, staffUserId: string) => {
  // Solo se cancela lo que aún no salió. PUBLISHING ya está en vuelo y
  // PUBLISHED es irreversible desde aquí.
  const updated = await prisma.socialPost.updateMany({
    where: { id, status: { in: ["DRAFT", "SCHEDULED", "FAILED"] } },
    data: { status: "CANCELED" },
  });
  if (updated.count === 0) {
    throw new Error("Esa publicación ya no se puede cancelar.");
  }

  await writeAuditLog({
    staffUserId,
    action: "SOCIAL_POST_CANCELED",
    entityType: "SocialPost",
    entityId: id,
  });

  return { id, status: "CANCELED" as const };
};

/**
 * Marca una publicación como en curso, de forma atómica.
 *
 * `updateMany` con el estado esperado en el `where` es la parte que impide
 * publicar dos veces: si dos ejecuciones del cron se solapan, solo una ve
 * `count === 1` y la otra se retira.
 */
export const claimForPublishing = async (id: string): Promise<boolean> => {
  const claimed = await prisma.socialPost.updateMany({
    where: { id, status: { in: ["SCHEDULED", "DRAFT"] } },
    data: { status: "PUBLISHING", attemptCount: { increment: 1 } },
  });
  return claimed.count === 1;
};

/** Publicaciones cuya hora ya pasó. */
export const findDuePosts = (now: Date = new Date()) =>
  prisma.socialPost.findMany({
    where: { status: "SCHEDULED", scheduledAt: { lte: now } },
    orderBy: { scheduledAt: "asc" },
    take: 20,
    select: { id: true },
  });

export const markPublished = async (
  id: string,
  data: { externalPublishId?: string; externalPostId?: string | null; postUrl?: string | null }
) =>
  prisma.socialPost.update({
    where: { id },
    data: {
      status: "PUBLISHED",
      publishedAt: new Date(),
      externalPublishId: data.externalPublishId,
      externalPostId: data.externalPostId ?? null,
      postUrl: data.postUrl ?? null,
      failedReason: null,
    },
    select: { id: true },
  });

export const markFailed = async (id: string, reason: string) =>
  prisma.socialPost.update({
    where: { id },
    data: { status: "FAILED", failedReason: reason.slice(0, 500) },
    select: { id: true },
  });
