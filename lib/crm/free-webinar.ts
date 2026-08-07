import { RecordingStatus, type FreeWebinar, type Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getMuxClient } from "@/lib/mux/client";
import { getSiteUrl } from "@/lib/site-url";
import { resetLinkEmails, resetReminders } from "@/lib/crm/webinar-registrations";
import {
  DEFAULT_OPERATIONAL_TZ,
  getDateKeyInTz,
  getOperationalTimezone,
  getTimeHmInTz,
  normalizeTimeHm,
  zonedDateTimeToUtc,
} from "@/lib/crm/operational-timezone";
import {
  PUBLISH_BLOCKER_LABELS,
  type PublishBlocker,
  type FreeWebinarFaqItem,
} from "@/lib/crm/free-webinar-publish";

export {
  PUBLISH_BLOCKER_LABELS,
  type PublishBlocker,
  type FreeWebinarFaqItem,
} from "@/lib/crm/free-webinar-publish";

export const FREE_WEBINAR_SLUG = "gratuito";

export type FreeWebinarPublic = {
  id: string;
  slug: string;
  isActive: boolean;
  headline: string;
  subheadline: string | null;
  body: string | null;
  startsAt: Date | null;
  startsAtIso: string | null;
  startsAtDateKey: string | null;
  startsAtTimeHm: string | null;
  startsAtHasTime: boolean;
  operationalTimezone: string;
  meetUrl: string | null;
  muxPlaybackId: string | null;
  videoStatus: RecordingStatus;
  videoDurationSec: number | null;
  videoErrorMessage: string | null;
  learnSectionTitle: string | null;
  learnItems: string[];
  faq: FreeWebinarFaqItem[];
  ctaLabel: string;
  formTitle: string;
  metaTitle: string | null;
  metaDescription: string | null;
  updatedAt: Date;
};

export type FreeWebinarUpdateInput = {
  isActive?: boolean;
  headline?: string;
  subheadline?: string | null;
  body?: string | null;
  startsAt?: Date | null;
  /** Calendar date + optional local time in OPERATIONAL_TZ. Empty/null time = date only. */
  startsAtLocal?: { date: string; time?: string | null } | null;
  startsAtHasTime?: boolean;
  /** Empty string is accepted and normalized to `null` (= "sin enlace"). */
  meetUrl?: string | null;
  learnSectionTitle?: string | null;
  learnItems?: string[];
  faq?: FreeWebinarFaqItem[];
  ctaLabel?: string;
  formTitle?: string;
  metaTitle?: string | null;
  metaDescription?: string | null;
};

const parseLearnItems = (raw: Prisma.JsonValue): string[] => {
  if (!Array.isArray(raw)) return [];
  return raw.filter((x): x is string => typeof x === "string" && x.trim().length > 0);
};

const parseFaq = (raw: Prisma.JsonValue | null): FreeWebinarFaqItem[] => {
  if (!raw || !Array.isArray(raw)) return [];
  const out: FreeWebinarFaqItem[] = [];
  for (const item of raw) {
    if (
      item &&
      typeof item === "object" &&
      !Array.isArray(item) &&
      typeof (item as { q?: unknown }).q === "string" &&
      typeof (item as { a?: unknown }).a === "string"
    ) {
      const q = (item as { q: string }).q.trim();
      const a = (item as { a: string }).a.trim();
      if (q && a) out.push({ q, a });
    }
  }
  return out;
};

export const toFreeWebinarPublic = (
  row: FreeWebinar,
  operationalTimezone: string = DEFAULT_OPERATIONAL_TZ
): FreeWebinarPublic => {
  const startsAt = row.startsAt;
  const startsAtHasTime = startsAt ? row.startsAtHasTime : false;
  return {
    id: row.id,
    slug: row.slug,
    isActive: row.isActive,
    headline: row.headline,
    subheadline: row.subheadline,
    body: row.body,
    startsAt,
    startsAtIso: startsAt ? startsAt.toISOString() : null,
    startsAtDateKey: startsAt
      ? getDateKeyInTz(startsAt, operationalTimezone)
      : null,
    startsAtTimeHm:
      startsAt && startsAtHasTime
        ? getTimeHmInTz(startsAt, operationalTimezone)
        : null,
    startsAtHasTime,
    operationalTimezone,
    meetUrl: row.meetUrl,
    muxPlaybackId: row.muxPlaybackId,
    videoStatus: row.videoStatus,
    videoDurationSec: row.videoDurationSec,
    videoErrorMessage: row.videoErrorMessage,
    learnSectionTitle: row.learnSectionTitle,
    learnItems: parseLearnItems(row.learnItems),
    faq: parseFaq(row.faq),
    ctaLabel: row.ctaLabel,
    formTitle: row.formTitle,
    metaTitle: row.metaTitle,
    metaDescription: row.metaDescription,
    updatedAt: row.updatedAt,
  };
};

/**
 * Etiqueta legible del horario: «9 de agosto de 2026 · 19:00 (America/Bogota)».
 * La usan el correo de confirmación, el del enlace y los dos recordatorios —
 * vive aquí para que no se dupliquen cuatro versiones ligeramente distintas.
 */
export const formatWebinarScheduleLabel = (
  webinar: Pick<
    FreeWebinarPublic,
    "startsAtDateKey" | "startsAtHasTime" | "startsAtTimeHm" | "operationalTimezone"
  >
): string | null => {
  if (!webinar.startsAtDateKey) return null;
  const [y, m, d] = webinar.startsAtDateKey.split("-").map(Number);
  if (!y || !m || !d) return webinar.startsAtDateKey;
  const date = new Date(Date.UTC(y, m - 1, d, 12));
  const datePart = date.toLocaleDateString("es-CO", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
  if (webinar.startsAtHasTime && webinar.startsAtTimeHm) {
    return `${datePart} · ${webinar.startsAtTimeHm} (${webinar.operationalTimezone})`;
  }
  return `${datePart} (fecha confirmada; hora por confirmar)`;
};

/**
 * Normaliza antes de comparar: guardar el mismo enlace con un espacio de más
 * no debe contar como cambio, porque un cambio reenvía el correo a todo el
 * mundo. Solo https — el enlace va dentro de un correo transaccional.
 */
export const normalizeMeetUrl = (raw: string | null | undefined): string | null => {
  const trimmed = raw?.trim();
  if (!trimmed) return null;
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new FreeWebinarMeetUrlError();
  }
  if (parsed.protocol !== "https:") throw new FreeWebinarMeetUrlError();
  return parsed.toString();
};

export class FreeWebinarMeetUrlError extends Error {
  constructor() {
    super("invalid_meet_url");
    this.name = "FreeWebinarMeetUrlError";
  }
}

export const getPublishBlockers = (
  w: Pick<
    FreeWebinarPublic,
    | "headline"
    | "subheadline"
    | "startsAt"
    | "learnItems"
    | "ctaLabel"
    | "formTitle"
  >
): PublishBlocker[] => {
  const blockers: PublishBlocker[] = [];
  if (!w.headline.trim()) blockers.push("headline");
  if (!w.subheadline?.trim()) blockers.push("subheadline");
  if (!w.startsAt) blockers.push("startsAt");
  if (w.learnItems.length === 0) blockers.push("learnItems");
  if (!w.ctaLabel.trim()) blockers.push("ctaLabel");
  if (!w.formTitle.trim()) blockers.push("formTitle");
  return blockers;
};

export const DEFAULT_FREE_WEBINAR = {
  isActive: false,
  headline: "Reprograma tu mente con PNL",
  subheadline:
    "Webinar gratuito en vivo con Dayana Beltrán — un primer paso claro para soltar patrones que te frenan.",
  body: null as string | null,
  startsAt: null as Date | null,
  meetUrl: null as string | null,
  learnSectionTitle: "Lo que vas a llevarte",
  learnItems: [
    "Qué es la PNL aplicada a tu día a día",
    "Cómo identificar un patrón mental que te cuesta paz o resultados",
    "Un ejercicio práctico para usar desde hoy",
    "Cómo saber si este camino es para ti",
  ],
  faq: [
    {
      q: "¿El webinar tiene costo?",
      a: "No. El acceso es gratuito; solo necesitas registrarte.",
    },
    {
      q: "¿Necesito experiencia previa?",
      a: "No. Está pensado para quienes empiezan o quieren claridad.",
    },
    {
      q: "¿Cómo me conecto?",
      a: "Tras registrarte te enviamos el enlace y los detalles.",
    },
  ] as FreeWebinarFaqItem[],
  ctaLabel: "Registrarme gratis",
  formTitle: "Reserva tu lugar",
  metaTitle: "Webinar gratuito de PNL | Dayana Beltrán",
  metaDescription:
    "Regístrate al webinar gratuito en vivo con Dayana Beltrán.",
};

/** Noon Bogotá — stable date anchor when the clock time is still TBD. */
const DATE_ONLY_ANCHOR_TIME = "12:00";

type ResolvedSchedule =
  | { startsAt: Date; startsAtHasTime: boolean }
  | { startsAt: null; startsAtHasTime: false };

const resolveSchedule = async (
  input: FreeWebinarUpdateInput
): Promise<ResolvedSchedule | undefined> => {
  if (input.startsAtLocal === null) {
    return { startsAt: null, startsAtHasTime: false };
  }
  if (input.startsAtLocal !== undefined) {
    const rawTime = input.startsAtLocal.time?.trim() ?? "";
    const normalized = rawTime ? normalizeTimeHm(rawTime) : null;
    const hasTime = Boolean(normalized);
    const tz = await getOperationalTimezone();
    return {
      startsAt: zonedDateTimeToUtc(
        input.startsAtLocal.date,
        hasTime && normalized ? normalized : DATE_ONLY_ANCHOR_TIME,
        tz
      ),
      startsAtHasTime: hasTime,
    };
  }
  if (input.startsAt !== undefined) {
    if (input.startsAt === null) {
      return { startsAt: null, startsAtHasTime: false };
    }
    return {
      startsAt: input.startsAt,
      startsAtHasTime: input.startsAtHasTime ?? true,
    };
  }
  if (input.startsAtHasTime !== undefined) {
    return undefined;
  }
  return undefined;
};

export const getFreeWebinar = async (
  slug: string = FREE_WEBINAR_SLUG
): Promise<FreeWebinarPublic | null> => {
  const row = await prisma.freeWebinar.findUnique({ where: { slug } });
  if (!row) return null;
  const tz = await getOperationalTimezone();
  return toFreeWebinarPublic(row, tz);
};

export const isFreeWebinarActive = async (
  slug: string = FREE_WEBINAR_SLUG
): Promise<boolean> => {
  const row = await prisma.freeWebinar.findUnique({
    where: { slug },
    select: { isActive: true, startsAt: true },
  });
  return row?.isActive === true && row.startsAt != null;
};

export const ensureFreeWebinar = async (
  slug: string = FREE_WEBINAR_SLUG
): Promise<FreeWebinarPublic> => {
  const tz = await getOperationalTimezone();
  const existing = await prisma.freeWebinar.findUnique({ where: { slug } });
  if (existing) return toFreeWebinarPublic(existing, tz);

  const created = await prisma.freeWebinar.create({
    data: {
      slug,
      isActive: false,
      headline: DEFAULT_FREE_WEBINAR.headline,
      subheadline: DEFAULT_FREE_WEBINAR.subheadline,
      body: DEFAULT_FREE_WEBINAR.body,
      startsAt: null,
      startsAtHasTime: false,
      videoUrl: null,
      learnSectionTitle: DEFAULT_FREE_WEBINAR.learnSectionTitle,
      learnItems: DEFAULT_FREE_WEBINAR.learnItems,
      faq: DEFAULT_FREE_WEBINAR.faq,
      ctaLabel: DEFAULT_FREE_WEBINAR.ctaLabel,
      formTitle: DEFAULT_FREE_WEBINAR.formTitle,
      metaTitle: DEFAULT_FREE_WEBINAR.metaTitle,
      metaDescription: DEFAULT_FREE_WEBINAR.metaDescription,
    },
  });
  return toFreeWebinarPublic(created, tz);
};

export class FreeWebinarPublishError extends Error {
  readonly blockers: PublishBlocker[];
  constructor(blockers: PublishBlocker[]) {
    super("not_publishable");
    this.name = "FreeWebinarPublishError";
    this.blockers = blockers;
  }
}

export type FreeWebinarUpdateResult = {
  webinar: FreeWebinarPublic;
  /** El enlace quedó distinto al guardado → hay que reenviarlo a todas. */
  meetUrlChanged: boolean;
  /** Se reprogramó → los recordatorios ya enviados dejan de valer. */
  startsAtChanged: boolean;
  /** Registros que vuelven a la cola del enlace por el cambio. */
  linkEmailsReset: number;
};

export const updateFreeWebinar = async (
  input: FreeWebinarUpdateInput,
  slug: string = FREE_WEBINAR_SLUG
): Promise<FreeWebinarUpdateResult> => {
  await ensureFreeWebinar(slug);

  const data: Prisma.FreeWebinarUpdateInput = {};
  if (input.headline !== undefined) data.headline = input.headline;
  if (input.subheadline !== undefined) data.subheadline = input.subheadline;
  if (input.body !== undefined) data.body = input.body;
  const schedule = await resolveSchedule(input);
  if (schedule !== undefined) {
    data.startsAt = schedule.startsAt;
    data.startsAtHasTime = schedule.startsAtHasTime;
  }
  if (input.learnSectionTitle !== undefined) {
    data.learnSectionTitle = input.learnSectionTitle;
  }
  if (input.learnItems !== undefined) data.learnItems = input.learnItems;
  if (input.faq !== undefined) data.faq = input.faq;
  if (input.ctaLabel !== undefined) data.ctaLabel = input.ctaLabel;
  if (input.formTitle !== undefined) data.formTitle = input.formTitle;
  if (input.metaTitle !== undefined) data.metaTitle = input.metaTitle;
  if (input.metaDescription !== undefined) {
    data.metaDescription = input.metaDescription;
  }
  if (input.isActive !== undefined) data.isActive = input.isActive;

  const tz = await getOperationalTimezone();
  const current = await prisma.freeWebinar.findUniqueOrThrow({ where: { slug } });

  const startsAtChanged =
    schedule !== undefined &&
    (schedule.startsAt?.getTime() ?? null) !==
      (current.startsAt?.getTime() ?? null);

  if (input.isActive === true) {
    const nextStartsAt =
      schedule !== undefined ? schedule.startsAt : current.startsAt;
    const nextHasTime =
      schedule !== undefined
        ? schedule.startsAtHasTime
        : current.startsAtHasTime;
    const preview = toFreeWebinarPublic(
      {
        ...current,
        headline:
          typeof data.headline === "string" ? data.headline : current.headline,
        subheadline:
          data.subheadline === undefined
            ? current.subheadline
            : (data.subheadline as string | null),
        body:
          data.body === undefined ? current.body : (data.body as string | null),
        startsAt: nextStartsAt,
        startsAtHasTime: nextHasTime,
        learnItems:
          input.learnItems !== undefined
            ? (input.learnItems as Prisma.JsonValue)
            : current.learnItems,
        ctaLabel:
          typeof data.ctaLabel === "string" ? data.ctaLabel : current.ctaLabel,
        formTitle:
          typeof data.formTitle === "string"
            ? data.formTitle
            : current.formTitle,
      },
      tz
    );
    const blockers = getPublishBlockers(preview);
    if (blockers.length > 0) {
      throw new FreeWebinarPublishError(blockers);
    }
  }

  const row = await prisma.freeWebinar.update({
    where: { slug },
    data,
  });

  // El enlace se escribe aparte, con compare-and-swap: es la base de datos la
  // que responde «¿cambió de verdad?». Guardar dos veces el mismo enlace no
  // puede disparar un envío masivo, y dos guardados simultáneos solo cuentan
  // como uno. Se escribe ANTES de limpiar los sellos: al revés, un fan-out
  // concurrente enviaría el enlace viejo y lo daría por entregado.
  let meetUrlChanged = false;
  let linkEmailsReset = 0;
  if (input.meetUrl !== undefined) {
    const next = normalizeMeetUrl(input.meetUrl);
    const where: Prisma.FreeWebinarWhereInput =
      next === null
        ? { slug, meetUrl: { not: null } }
        : { slug, OR: [{ meetUrl: null }, { meetUrl: { not: next } }] };
    const { count } = await prisma.freeWebinar.updateMany({
      where,
      data: { meetUrl: next },
    });
    meetUrlChanged = count > 0;
    if (meetUrlChanged && next !== null) {
      linkEmailsReset = await resetLinkEmails(row.id);
    }
  }

  // Reprogramar sin esto dejaría los recordatorios sellados de la fecha
  // anterior: nadie recibiría aviso de la nueva.
  if (startsAtChanged) {
    await resetReminders(row.id);
  }

  const finalRow =
    input.meetUrl !== undefined
      ? await prisma.freeWebinar.findUniqueOrThrow({ where: { slug } })
      : row;

  return {
    webinar: toFreeWebinarPublic(finalRow, tz),
    meetUrlChanged,
    startsAtChanged,
    linkEmailsReset,
  };
};

export const clearFreeWebinarSchedule = async (
  slug: string = FREE_WEBINAR_SLUG
): Promise<FreeWebinarPublic> =>
  (await updateFreeWebinar({ isActive: false, startsAt: null }, slug)).webinar;

export const resetFreeWebinar = async (
  slug: string = FREE_WEBINAR_SLUG
): Promise<FreeWebinarPublic> => {
  await ensureFreeWebinar(slug);
  const row = await prisma.freeWebinar.update({
    where: { slug },
    data: {
      isActive: false,
      headline: DEFAULT_FREE_WEBINAR.headline,
      subheadline: DEFAULT_FREE_WEBINAR.subheadline,
      body: DEFAULT_FREE_WEBINAR.body,
      startsAt: null,
      startsAtHasTime: false,
      meetUrl: null,
      videoUrl: null,
      ...CLEARED_VIDEO_FIELDS,
      learnSectionTitle: DEFAULT_FREE_WEBINAR.learnSectionTitle,
      learnItems: DEFAULT_FREE_WEBINAR.learnItems,
      faq: DEFAULT_FREE_WEBINAR.faq,
      ctaLabel: DEFAULT_FREE_WEBINAR.ctaLabel,
      formTitle: DEFAULT_FREE_WEBINAR.formTitle,
      metaTitle: DEFAULT_FREE_WEBINAR.metaTitle,
      metaDescription: DEFAULT_FREE_WEBINAR.metaDescription,
    },
  });
  await resetLinkEmails(row.id);
  await resetReminders(row.id);
  const tz = await getOperationalTimezone();
  return toFreeWebinarPublic(row, tz);
};

/* -------------------------------------------------------------------------
 * Vídeo promocional (Mux)
 *
 * Mismo pipeline que las grabaciones del curso (`lib/lms/course-admin.ts`)
 * salvo un detalle deliberado: la política de reproducción es `public`, no
 * `signed`. Es una landing de marketing — sin JWT, sin ruta de token, y el
 * reproductor puede pedir el HLS directamente al CDN de Mux. No reutilizar
 * este helper para contenido de miembros.
 * ---------------------------------------------------------------------- */

const CLEARED_VIDEO_FIELDS = {
  muxUploadId: null,
  muxAssetId: null,
  muxPlaybackId: null,
  videoStatus: RecordingStatus.NONE,
  videoDurationSec: null,
  videoErrorMessage: null,
} satisfies Prisma.FreeWebinarUpdateInput;

/** Abre una subida directa en Mux y deja la fila en `UPLOADING`. */
export const createWebinarVideoUpload = async (
  slug: string = FREE_WEBINAR_SLUG
): Promise<{ uploadUrl: string; uploadId: string }> => {
  await ensureFreeWebinar(slug);
  const mux = getMuxClient();
  const created = await mux.video.uploads.create({
    cors_origin: getSiteUrl(),
    new_asset_settings: {
      playback_policy: ["public"],
      mp4_support: "none",
      // Solo para identificarlo en el panel de Mux. El webhook NO se ramifica
      // por aquí: los ids de Mux son únicos y basta con el count del update.
      passthrough: "free-webinar",
    },
  });

  // El SDK tipa `url` como opcional; sin ella no hay nada que subir y es mejor
  // fallar aquí que dejar la fila en UPLOADING para siempre.
  if (!created.url) throw new Error("mux_upload_without_url");

  await prisma.freeWebinar.update({
    where: { slug },
    data: {
      ...CLEARED_VIDEO_FIELDS,
      muxUploadId: created.id,
      videoStatus: RecordingStatus.UPLOADING,
    },
  });

  return { uploadUrl: created.url, uploadId: created.id };
};

export const clearWebinarVideo = async (
  slug: string = FREE_WEBINAR_SLUG
): Promise<FreeWebinarPublic> => {
  await ensureFreeWebinar(slug);
  const row = await prisma.freeWebinar.update({
    where: { slug },
    data: { ...CLEARED_VIDEO_FIELDS, videoUrl: null },
  });
  const tz = await getOperationalTimezone();
  return toFreeWebinarPublic(row, tz);
};

/** `video.upload.asset_created` — existe el asset, aún no está codificado. */
export const handleWebinarMuxAssetCreated = async (
  uploadId: string,
  assetId: string
): Promise<number> => {
  const { count } = await prisma.freeWebinar.updateMany({
    where: { muxUploadId: uploadId },
    data: { muxAssetId: assetId, videoStatus: RecordingStatus.PROCESSING },
  });
  return count;
};

/** `video.asset.ready` — a partir de aquí la landing lo reproduce. */
export const handleWebinarMuxAssetReady = async (
  assetId: string,
  playbackId: string,
  durationSec: number | null
): Promise<number> => {
  const { count } = await prisma.freeWebinar.updateMany({
    where: { muxAssetId: assetId },
    data: {
      muxPlaybackId: playbackId,
      videoStatus: RecordingStatus.READY,
      videoDurationSec: durationSec,
      videoErrorMessage: null,
    },
  });
  return count;
};

export const handleWebinarMuxAssetErrored = async (
  assetId: string,
  message: string | null
): Promise<number> => {
  const { count } = await prisma.freeWebinar.updateMany({
    where: { muxAssetId: assetId },
    data: {
      videoStatus: RecordingStatus.ERRORED,
      videoErrorMessage: message,
    },
  });
  return count;
};

/**
 * Reconciliación contra la API de Mux para cuando el webhook no llega — en
 * local nunca llega (Mux no alcanza `localhost`), y en producción un webhook
 * perdido dejaría el vídeo colgado en «procesando» para siempre.
 */
export const reconcileWebinarVideo = async (
  slug: string = FREE_WEBINAR_SLUG
): Promise<FreeWebinarPublic> => {
  const tz = await getOperationalTimezone();
  const row = await prisma.freeWebinar.findUniqueOrThrow({ where: { slug } });

  const pending =
    row.videoStatus === RecordingStatus.UPLOADING ||
    row.videoStatus === RecordingStatus.PROCESSING;
  if (!pending) return toFreeWebinarPublic(row, tz);

  const mux = getMuxClient();
  let assetId = row.muxAssetId;

  if (!assetId && row.muxUploadId) {
    const upload = await mux.video.uploads.retrieve(row.muxUploadId);
    assetId = upload.asset_id ?? null;
    if (!assetId) return toFreeWebinarPublic(row, tz);
    await handleWebinarMuxAssetCreated(row.muxUploadId, assetId);
  }
  if (!assetId) return toFreeWebinarPublic(row, tz);

  const asset = await mux.video.assets.retrieve(assetId);
  if (asset.status === "ready") {
    const playbackId = asset.playback_ids?.[0]?.id;
    if (playbackId) {
      await handleWebinarMuxAssetReady(
        assetId,
        playbackId,
        typeof asset.duration === "number" ? Math.round(asset.duration) : null
      );
    }
  } else if (asset.status === "errored") {
    await handleWebinarMuxAssetErrored(
      assetId,
      asset.errors?.messages?.join("; ") ?? null
    );
  }

  const fresh = await prisma.freeWebinar.findUniqueOrThrow({ where: { slug } });
  return toFreeWebinarPublic(fresh, tz);
};
