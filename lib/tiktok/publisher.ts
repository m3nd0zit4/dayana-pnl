import {
  claimForPublishing,
  getSocialPost,
  markFailed,
  markPublished,
} from "@/lib/crm/social-posts";
import { fireNotification } from "@/lib/notifications/platform/emit";
import { getValidAccessToken } from "./oauth";
import {
  extractPostId,
  fetchPublishStatus,
  initVideoPost,
  queryCreatorInfo,
  uploadVideo,
} from "./publish";

/**
 * Orquesta la publicación de una entrada programada.
 *
 * El orden importa: primero se reclama la fila (para no publicar dos veces),
 * y solo después se toca la red. Cualquier fallo posterior deja la fila en
 * FAILED con el motivo, nunca colgada en PUBLISHING.
 */

export type PublishOutcome =
  | { outcome: "published"; postId: string | null }
  | { outcome: "pending"; publishId: string }
  | { outcome: "skipped"; reason: string }
  | { outcome: "failed"; reason: string };

const readMediaUrls = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];

/** TikTok procesa en segundo plano; se sondea un rato antes de rendirse. */
const STATUS_POLL_ATTEMPTS = 6;
const STATUS_POLL_DELAY_MS = 5000;

export const publishSocialPost = async (
  postId: string
): Promise<PublishOutcome> => {
  const post = await getSocialPost(postId);
  if (!post) return { outcome: "skipped", reason: "post_not_found" };
  if (post.account.provider !== "TIKTOK") {
    return { outcome: "skipped", reason: "provider_not_supported" };
  }
  if (post.mediaType !== "VIDEO") {
    // Las fotos exigen PULL_FROM_URL desde un dominio verificado por TikTok;
    // no se puede servir desde Blob. Queda fuera de esta fase a propósito.
    return { outcome: "skipped", reason: "photo_posts_not_supported_yet" };
  }

  if (!(await claimForPublishing(postId))) {
    return { outcome: "skipped", reason: "already_claimed" };
  }

  try {
    const mediaUrls = readMediaUrls(post.mediaUrls);
    const videoUrl = mediaUrls[0];
    if (!videoUrl) throw new Error("La publicación no tiene archivo de vídeo.");

    const accessToken = await getValidAccessToken(post.accountId);

    // TikTok exige consultar al creador antes de un Direct Post, y de paso nos
    // dice qué visibilidades acepta esta cuenta en concreto.
    const creator = await queryCreatorInfo(accessToken);
    if (!creator.privacy_level_options.includes(post.privacyLevel)) {
      throw new Error(
        `La cuenta no admite la visibilidad ${post.privacyLevel}. Opciones: ${creator.privacy_level_options.join(", ")}.`
      );
    }

    const media = await fetch(videoUrl);
    if (!media.ok) {
      throw new Error(`No se pudo descargar el vídeo (${media.status}).`);
    }
    const bytes = await media.arrayBuffer();
    if (bytes.byteLength === 0) throw new Error("El archivo de vídeo está vacío.");

    const { publishId, uploadUrl } = await initVideoPost(
      accessToken,
      {
        title: post.caption ?? "",
        privacyLevel: post.privacyLevel,
        disableComment: post.disableComment,
        disableDuet: post.disableDuet,
        disableStitch: post.disableStitch,
      },
      bytes.byteLength
    );

    // El upload_url caduca en una hora, así que se usa de inmediato.
    await uploadVideo(
      uploadUrl,
      bytes,
      media.headers.get("content-type") ?? "video/mp4"
    );

    for (let attempt = 0; attempt < STATUS_POLL_ATTEMPTS; attempt += 1) {
      const status = await fetchPublishStatus(accessToken, publishId);

      if (status.status === "PUBLISH_COMPLETE") {
        const externalPostId = extractPostId(status);
        await markPublished(postId, {
          externalPublishId: publishId,
          externalPostId,
          postUrl:
            externalPostId && creator.creator_username
              ? `https://www.tiktok.com/@${creator.creator_username}/video/${externalPostId}`
              : null,
        });

        fireNotification({
          eventType: "SOCIAL_POST_PUBLISHED",
          title: "Publicación enviada a TikTok",
          body: post.caption?.slice(0, 120) ?? "Sin descripción",
          href: "/admin/contenido",
          entityType: "SocialPost",
          entityId: postId,
          staff: "ALL",
        });

        return { outcome: "published", postId: externalPostId };
      }

      if (status.status === "FAILED") {
        throw new Error(status.fail_reason ?? "TikTok rechazó la publicación.");
      }

      await new Promise((resolve) => setTimeout(resolve, STATUS_POLL_DELAY_MS));
    }

    // Sigue procesando. No es un fallo: se deja el publish_id y el cron de
    // reconciliación lo cerrará cuando TikTok termine.
    await markPublished(postId, { externalPublishId: publishId });
    return { outcome: "pending", publishId };
  } catch (e) {
    const reason = e instanceof Error ? e.message : "Error desconocido";
    await markFailed(postId, reason);

    fireNotification({
      eventType: "SOCIAL_POST_FAILED",
      title: "No se pudo publicar en TikTok",
      body: reason.slice(0, 160),
      href: "/admin/contenido",
      entityType: "SocialPost",
      entityId: postId,
      staff: "ALL",
    });

    return { outcome: "failed", reason };
  }
};
