import { tiktokGet, tiktokPost, TikTokApiError } from "./client";

/**
 * Publicación de contenido en TikTok.
 *
 * Se usa **FILE_UPLOAD** (subir los bytes) y no PULL_FROM_URL a propósito:
 * TikTok solo descarga de dominios verificados en la consola de desarrollador, y
 * los archivos viven en Vercel Blob (`*.vercel-storage.com`), un dominio que no
 * es nuestro y que por tanto nunca podremos verificar. Subir los bytes evita esa
 * dependencia por completo.
 */

export type CreatorInfo = {
  creator_avatar_url: string;
  creator_username: string;
  creator_nickname: string;
  privacy_level_options: string[];
  comment_disabled: boolean;
  duet_disabled: boolean;
  stitch_disabled: boolean;
  max_video_post_duration_sec: number;
};

/**
 * Obligatorio antes de un Direct Post.
 *
 * Además de ser un requisito de TikTok, devuelve `privacy_level_options`, que
 * es la única forma fiable de saber qué visibilidad acepta la cuenta: una
 * cuenta privada no admite PUBLIC_TO_EVERYONE por mucho que la app esté
 * auditada.
 */
export const queryCreatorInfo = (accessToken: string) =>
  tiktokPost<CreatorInfo>("/post/publish/creator_info/query/", {}, accessToken);

export type PostInfo = {
  title?: string;
  privacyLevel: string;
  disableComment?: boolean;
  disableDuet?: boolean;
  disableStitch?: boolean;
  videoCoverTimestampMs?: number;
};

type InitResponse = { publish_id: string; upload_url?: string };

const MB = 1024 * 1024;
/**
 * Máximo por trozo que acepta TikTok. El mínimo (5 MB) no aparece como
 * constante porque `planChunks` nunca genera un trozo por debajo: un archivo
 * pequeño va entero en una sola pieza.
 */
const MAX_CHUNK = 64 * MB;

export type ChunkPlan = {
  chunkSize: number;
  totalChunkCount: number;
};

/**
 * Calcula el troceado.
 *
 * Un archivo por debajo del mínimo de trozo debe ir en UNA sola pieza: pedir
 * varios trozos de menos de 5 MB es rechazado. Y el último trozo absorbe el
 * resto en vez de generar una pieza corta extra, que es el error clásico aquí.
 */
export const planChunks = (fileSize: number): ChunkPlan => {
  if (fileSize <= MAX_CHUNK) {
    return { chunkSize: fileSize, totalChunkCount: 1 };
  }
  const totalChunkCount = Math.floor(fileSize / MAX_CHUNK);
  return { chunkSize: MAX_CHUNK, totalChunkCount };
};

export const initVideoPost = async (
  accessToken: string,
  post: PostInfo,
  fileSize: number
): Promise<{ publishId: string; uploadUrl: string }> => {
  const { chunkSize, totalChunkCount } = planChunks(fileSize);

  const data = await tiktokPost<InitResponse>(
    "/post/publish/video/init/",
    {
      post_info: {
        title: post.title ?? "",
        privacy_level: post.privacyLevel,
        disable_comment: post.disableComment ?? false,
        disable_duet: post.disableDuet ?? false,
        disable_stitch: post.disableStitch ?? false,
        ...(post.videoCoverTimestampMs != null
          ? { video_cover_timestamp_ms: post.videoCoverTimestampMs }
          : {}),
      },
      source_info: {
        source: "FILE_UPLOAD",
        video_size: fileSize,
        chunk_size: chunkSize,
        total_chunk_count: totalChunkCount,
      },
    },
    accessToken
  );

  if (!data.upload_url) {
    throw new TikTokApiError("TikTok no devolvió upload_url.", {
      code: "missing_upload_url",
      httpStatus: 200,
    });
  }

  return { publishId: data.publish_id, uploadUrl: data.upload_url };
};

/**
 * Sube el archivo al `upload_url`.
 *
 * La URL caduca **una hora** después de emitirse, así que el init y la subida
 * tienen que ir en la misma ejecución; no vale guardarla para más tarde.
 */
export const uploadVideo = async (
  uploadUrl: string,
  bytes: ArrayBuffer,
  contentType = "video/mp4"
): Promise<void> => {
  const total = bytes.byteLength;
  const { chunkSize, totalChunkCount } = planChunks(total);

  for (let index = 0; index < totalChunkCount; index += 1) {
    const start = index * chunkSize;
    // El último trozo se queda con todo lo que sobre.
    const end = index === totalChunkCount - 1 ? total - 1 : start + chunkSize - 1;
    const slice = bytes.slice(start, end + 1);

    const res = await fetch(uploadUrl, {
      method: "PUT",
      headers: {
        "Content-Type": contentType,
        "Content-Length": String(slice.byteLength),
        "Content-Range": `bytes ${start}-${end}/${total}`,
      },
      body: slice,
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new TikTokApiError(
        `Fallo subiendo el trozo ${index + 1}/${totalChunkCount}: ${res.status} ${detail}`,
        { code: "upload_failed", httpStatus: res.status }
      );
    }
  }
};

export type PublishStatus = {
  status: string;
  fail_reason?: string;
  publicaly_available_post_id?: string[];
  /** TikTok escribe mal el campo anterior; se acepta también el correcto. */
  publicly_available_post_id?: string[];
  uploaded_bytes?: number;
};

export const fetchPublishStatus = (accessToken: string, publishId: string) =>
  tiktokPost<PublishStatus>(
    "/post/publish/status/fetch/",
    { publish_id: publishId },
    accessToken
  );

export const extractPostId = (status: PublishStatus): string | null =>
  status.publicly_available_post_id?.[0] ??
  status.publicaly_available_post_id?.[0] ??
  null;

export type TikTokUser = {
  open_id: string;
  display_name?: string;
  username?: string;
  avatar_url?: string;
};

export const fetchUserInfo = (accessToken: string) =>
  tiktokGet<{ user: TikTokUser }>(
    "/user/info/",
    { fields: "open_id,display_name,username,avatar_url" },
    accessToken
  );
