import { Prisma, RecordingStatus, type FreeEventStatus, type FreeWebinar } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getMuxClient } from "@/lib/mux/client";
import { getSiteUrl } from "@/lib/site-url";
import { resetLinkEmails, resetReminders } from "@/lib/crm/webinar-registrations";
import {
  DEFAULT_OPERATIONAL_TZ,
  getDateKeyInTz,
  getOperationalTimezone,
  getStartOfNextDayInTz,
  getTimeHmInTz,
  normalizeTimeHm,
  zonedDateTimeToUtc,
} from "@/lib/crm/operational-timezone";
import {
  type PublishBlocker,
  type FreeWebinarFaqItem,
} from "@/lib/crm/free-webinar-publish";
import {
  recordFreeEventActivitiesTx,
  recordFreeEventActivity,
  type FreeEventActivityInput,
} from "@/lib/crm/free-event-activity";
import {
  FREE_EVENT_ALIAS_SLUG,
  ENDED_EVENT_MESSAGE,
  freeEventAcceptsReminders,
  freeEventPublicPath,
  freeEventSlugBase,
  freeEventSlugCandidates,
  isFreeEventEnded,
  isFreeEventOpenRow,
  isReservedFreeEventSlug,
  pickCurrentFreeEvent,
  resolveRegistrationTarget,
  statusAfterReopen,
  statusAfterUnpublish,
} from "@/lib/crm/free-event-rules";

export {
  PUBLISH_BLOCKER_LABELS,
  type PublishBlocker,
  type FreeWebinarFaqItem,
} from "@/lib/crm/free-webinar-publish";

/**
 * Eventos gratuitos, uno por fila, como las ediciones de los talleres.
 *
 * Antes había una sola fila viva (`slug = "gratuito"`) y el historial se hacía
 * renombrándola. Ahora cada evento tiene su fila, su estado (borrador →
 * publicado → inscripciones cerradas → realizado), sus inscritas y su
 * historia. «El evento actual» lo decide `pickCurrentFreeEvent`; `gratuito`
 * queda como alias público de ese evento.
 */
export const FREE_WEBINAR_SLUG = FREE_EVENT_ALIAS_SLUG;

export type FreeWebinarPublic = {
  id: string;
  slug: string;
  status: FreeEventStatus;
  /** Espejo de `status === OPEN`. */
  isActive: boolean;
  publishedAt: Date | null;
  /** Página propia del evento (`/eventos-gratuitos/<slug>`). */
  publicPath: string;
  headline: string;
  subheadline: string | null;
  body: string | null;
  startsAt: Date | null;
  startsAtIso: string | null;
  startsAtDateKey: string | null;
  startsAtTimeHm: string | null;
  startsAtHasTime: boolean;
  operationalTimezone: string;
  /** Cupo previsto. Informativo: no cierra el formulario ni frena el enlace. */
  capacity: number | null;
  materialUrl: string | null;
  materialFileName: string | null;
  materialMimeType: string | null;
  materialSizeBytes: number | null;
  endedAt: Date | null;
  archivedAt: Date | null;
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
  /** Qué es el evento: etiqueta de la página y nombre en los correos. */
  eventLabel: string;
  locationLabel: string;
  priceLabel: string;
  faqTitle: string | null;
  materialLabel: string | null;
  successMessage: string | null;
  /** Botón en /enlaces. */
  linkEnabled: boolean;
  linkTitle: string | null;
  linkSubtitle: string | null;
  /** Confirmación por WhatsApp al inscribirse. */
  waConfirmationEnabled: boolean;
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
  capacity?: number | null;
  learnSectionTitle?: string | null;
  learnItems?: string[];
  faq?: FreeWebinarFaqItem[];
  ctaLabel?: string;
  formTitle?: string;
  metaTitle?: string | null;
  metaDescription?: string | null;
  eventLabel?: string;
  locationLabel?: string;
  priceLabel?: string;
  faqTitle?: string | null;
  materialLabel?: string | null;
  successMessage?: string | null;
  linkEnabled?: boolean;
  linkTitle?: string | null;
  linkSubtitle?: string | null;
  waConfirmationEnabled?: boolean;
};

/** Quién hace el cambio, para la historia del evento. */
export type FreeEventActor = { staffUserId?: string | null };

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
    status: row.status,
    isActive: row.isActive,
    publishedAt: row.publishedAt,
    publicPath: freeEventPublicPath(row),
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
    capacity: row.capacity,
    materialUrl: row.materialUrl,
    materialFileName: row.materialFileName,
    materialMimeType: row.materialMimeType,
    materialSizeBytes: row.materialSizeBytes,
    endedAt: row.endedAt,
    archivedAt: row.archivedAt,
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
    eventLabel: row.eventLabel,
    locationLabel: row.locationLabel,
    priceLabel: row.priceLabel,
    faqTitle: row.faqTitle,
    materialLabel: row.materialLabel,
    successMessage: row.successMessage,
    linkEnabled: row.linkEnabled,
    linkTitle: row.linkTitle,
    linkSubtitle: row.linkSubtitle,
    waConfirmationEnabled: row.waConfirmationEnabled,
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
  input: Pick<FreeWebinarUpdateInput, "startsAtLocal" | "startsAt" | "startsAtHasTime">
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
  return undefined;
};

/* -------------------------------------------------------------------------
 * Cuál es el evento: el actual, el abierto, uno por id o por URL
 * ---------------------------------------------------------------------- */

const CURRENT_SELECT = {
  id: true,
  slug: true,
  status: true,
  startsAt: true,
  endedAt: true,
  publishedAt: true,
  createdAt: true,
} satisfies Prisma.FreeWebinarSelect;

/** La fila del evento actual (ver `pickCurrentFreeEvent`), sin crear nada. */
export const findCurrentFreeEventRow = async (): Promise<FreeWebinar | null> => {
  const candidates = await prisma.freeWebinar.findMany({ select: CURRENT_SELECT });
  const pick = pickCurrentFreeEvent(candidates);
  return pick ? prisma.freeWebinar.findUnique({ where: { id: pick.id } }) : null;
};

/** El evento actual, o null si todavía no hay ninguno. No crea filas. */
export const getCurrentFreeEvent = async (): Promise<FreeWebinarPublic | null> => {
  const row = await findCurrentFreeEventRow();
  if (!row) return null;
  return toFreeWebinarPublic(row, await getOperationalTimezone());
};

/**
 * El evento abierto a inscripciones: el de `/eventos-gratuitos`, `/enlaces`,
 * el sitemap y `/api/leads`. Una sola consulta (índice `status, starts_at`):
 * la landing la hace en cada visita.
 */
export const getOpenFreeEvent = async (): Promise<FreeWebinarPublic | null> => {
  const row = await prisma.freeWebinar.findFirst({
    where: { status: "OPEN", startsAt: { not: null }, endedAt: null },
    orderBy: [{ startsAt: "desc" }, { publishedAt: "desc" }],
  });
  if (!row) return null;
  return toFreeWebinarPublic(row, await getOperationalTimezone());
};

export const getFreeEventById = async (id: string): Promise<FreeWebinarPublic | null> => {
  const row = await prisma.freeWebinar.findUnique({ where: { id } });
  if (!row) return null;
  return toFreeWebinarPublic(row, await getOperationalTimezone());
};

/** Uno concreto por id; sin id, el actual. No crea filas. */
export const getFreeWebinar = async (
  eventId?: string
): Promise<FreeWebinarPublic | null> =>
  eventId ? getFreeEventById(eventId) : getCurrentFreeEvent();

/** ¿Hay un evento abierto a inscripciones? */
export const isFreeWebinarActive = async (): Promise<boolean> =>
  (await getOpenFreeEvent()) !== null;

export type FreeEventSlugLookup =
  | { kind: "event"; event: FreeWebinarPublic }
  | { kind: "redirect"; to: string }
  | { kind: "current" }
  | { kind: "not_found" };

/**
 * `/eventos-gratuitos/<slug>`: el evento con esa URL; una URL vieja redirige a
 * la de ahora; `gratuito` es el evento actual; y la fila heredada que aún se
 * llama `gratuito` se alcanza por su id.
 */
export const findFreeEventByPublicSlug = async (slug: string): Promise<FreeEventSlugLookup> => {
  if (isReservedFreeEventSlug(slug)) return { kind: "current" };
  const tz = await getOperationalTimezone();
  const bySlug = await prisma.freeWebinar.findUnique({ where: { slug } });
  if (bySlug) return { kind: "event", event: toFreeWebinarPublic(bySlug, tz) };
  const renamed = await prisma.freeWebinar.findFirst({
    where: { previousSlugs: { has: slug } },
    select: { id: true, slug: true },
  });
  if (renamed) return { kind: "redirect", to: freeEventPublicPath(renamed) };
  const byId = await prisma.freeWebinar.findUnique({ where: { id: slug } });
  if (byId) {
    return isReservedFreeEventSlug(byId.slug)
      ? { kind: "event", event: toFreeWebinarPublic(byId, tz) }
      : { kind: "redirect", to: freeEventPublicPath(byId) };
  }
  return { kind: "not_found" };
};

/* -------------------------------------------------------------------------
 * URLs de los eventos
 * ---------------------------------------------------------------------- */

type Db = Pick<typeof prisma, "freeWebinar">;

/** ¿La usa ya otro evento, hoy o antes de cambiarla? `gratuito` siempre. */
export const isFreeEventSlugInUse = async (
  slug: string,
  exceptId?: string,
  db: Db = prisma
): Promise<boolean> => {
  if (isReservedFreeEventSlug(slug)) return true;
  const hit = await db.freeWebinar.findFirst({
    where: {
      OR: [{ slug }, { previousSlugs: { has: slug } }],
      ...(exceptId ? { NOT: { id: exceptId } } : {}),
    },
    select: { id: true },
  });
  return hit !== null;
};

const uniqueFreeEventSlug = async (
  base: string,
  exceptId?: string,
  db: Db = prisma
): Promise<string> => {
  for (const candidate of freeEventSlugCandidates(base)) {
    if (!(await isFreeEventSlugInUse(candidate, exceptId, db))) return candidate;
  }
  return `${base}-${Date.now()}`;
};

const slugBaseFor = (
  row: { headline: string; startsAt: Date | null },
  tz: string
): string => freeEventSlugBase(row.headline, row.startsAt ? getDateKeyInTz(row.startsAt, tz) : null);

/* -------------------------------------------------------------------------
 * Crear, copiar, borrar
 * ---------------------------------------------------------------------- */

/** Lo que pasa de un evento a otro al copiar la página: la marca, no la fecha. */
const pageTemplateOf = (src: FreeWebinar) => ({
  headline: src.headline,
  subheadline: src.subheadline,
  body: src.body,
  learnSectionTitle: src.learnSectionTitle,
  learnItems: src.learnItems as Prisma.InputJsonValue,
  // `faq` es Json anulable: `null` escribiría un JSON null, no un NULL de SQL.
  faq: src.faq === null ? Prisma.DbNull : (src.faq as Prisma.InputJsonValue),
  ctaLabel: src.ctaLabel,
  formTitle: src.formTitle,
  metaTitle: src.metaTitle,
  metaDescription: src.metaDescription,
  eventLabel: src.eventLabel,
  locationLabel: src.locationLabel,
  priceLabel: src.priceLabel,
  faqTitle: src.faqTitle,
  materialLabel: src.materialLabel,
  successMessage: src.successMessage,
  linkEnabled: src.linkEnabled,
  linkTitle: src.linkTitle,
  linkSubtitle: src.linkSubtitle,
  capacity: src.capacity,
  waConfirmationEnabled: src.waConfirmationEnabled,
  // El material es del tema, no de la fecha. Quitarlo de un evento no borra el
  // archivo si otro lo sigue usando (`materialBlobInUse`).
  materialUrl: src.materialUrl,
  materialFileName: src.materialFileName,
  materialMimeType: src.materialMimeType,
  materialSizeBytes: src.materialSizeBytes,
  // El vídeo listo se comparte por su playbackId. Los ids de subida y de asset
  // NO: el webhook de Mux casa por ellos con updateMany y escribiría en las
  // dos filas. Uno a medio procesar no se copia.
  ...(src.videoStatus === RecordingStatus.READY && src.muxPlaybackId
    ? {
        muxPlaybackId: src.muxPlaybackId,
        videoStatus: RecordingStatus.READY,
        videoDurationSec: src.videoDurationSec,
      }
    : {}),
});

const defaultTemplate = () => ({
  headline: DEFAULT_FREE_WEBINAR.headline,
  subheadline: DEFAULT_FREE_WEBINAR.subheadline,
  body: DEFAULT_FREE_WEBINAR.body,
  learnSectionTitle: DEFAULT_FREE_WEBINAR.learnSectionTitle,
  learnItems: DEFAULT_FREE_WEBINAR.learnItems,
  faq: DEFAULT_FREE_WEBINAR.faq,
  ctaLabel: DEFAULT_FREE_WEBINAR.ctaLabel,
  formTitle: DEFAULT_FREE_WEBINAR.formTitle,
  metaTitle: DEFAULT_FREE_WEBINAR.metaTitle,
  metaDescription: DEFAULT_FREE_WEBINAR.metaDescription,
});

export type CreateFreeEventInput = {
  headline?: string | null;
  startsAtLocal?: { date: string; time?: string | null } | null;
  /** Copiar la página (textos, FAQ, vídeo, material…) de otro evento. */
  copyFromId?: string | null;
};

/**
 * Un evento nuevo, en borrador. Nunca hereda la fecha, el enlace de la
 * reunión ni las inscritas: esos son hechos de cada edición. Heredar el
 * `meetUrl` haría que el compare-and-swap viera «no cambió» al volver a pegar
 * el enlace de una sala recurrente, y no se enviaría a nadie.
 */
export const createFreeEvent = async (
  input: CreateFreeEventInput = {},
  actor: FreeEventActor = {}
): Promise<FreeWebinarPublic> => {
  const tz = await getOperationalTimezone();
  const source = input.copyFromId
    ? await prisma.freeWebinar.findUnique({ where: { id: input.copyFromId } })
    : null;
  if (input.copyFromId && !source) throw new FreeEventLifecycleError("not_found");

  const template = source ? pageTemplateOf(source) : defaultTemplate();
  const headline = input.headline?.trim() || template.headline;
  const schedule = input.startsAtLocal ? await resolveSchedule({ startsAtLocal: input.startsAtLocal }) : undefined;
  const startsAt = schedule?.startsAt ?? null;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const slug = await uniqueFreeEventSlug(slugBaseFor({ headline, startsAt }, tz));
    try {
      const row = await prisma.freeWebinar.create({
        data: {
          ...template,
          headline,
          slug,
          status: "DRAFT",
          isActive: false,
          startsAt,
          startsAtHasTime: schedule?.startsAtHasTime ?? false,
          meetUrl: null,
          endedAt: null,
          archivedAt: null,
        },
      });
      await recordFreeEventActivity({
        freeWebinarId: row.id,
        kind: "created",
        at: row.createdAt,
        staffUserId: actor.staffUserId,
        meta: source ? { copiedFromId: source.id, copiedFromHeadline: source.headline } : null,
      });
      return toFreeWebinarPublic(row, tz);
    } catch (e) {
      // Dos altas a la vez eligieron la misma URL: el índice único decide y la
      // segunda prueba la siguiente.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") continue;
      throw e;
    }
  }
  throw new Error("free_event_slug_race");
};

/** «Duplicar»: un borrador nuevo con la página de este. */
export const duplicateFreeEvent = (
  id: string,
  actor: FreeEventActor = {}
): Promise<FreeWebinarPublic> => createFreeEvent({ copyFromId: id }, actor);

/**
 * El evento sobre el que se trabaja: el indicado o el actual. Si no hay
 * ninguno —base recién creada— se crea un borrador, como hacía siempre la
 * fila única.
 */
const resolveRow = async (eventId?: string): Promise<FreeWebinar> => {
  if (eventId) return prisma.freeWebinar.findUniqueOrThrow({ where: { id: eventId } });
  const current = await findCurrentFreeEventRow();
  if (current) return current;
  const created = await createFreeEvent();
  return prisma.freeWebinar.findUniqueOrThrow({ where: { id: created.id } });
};

/** Uno por id o el actual; con la base vacía, crea el primer borrador. */
export const ensureFreeWebinar = async (eventId?: string): Promise<FreeWebinarPublic> =>
  toFreeWebinarPublic(await resolveRow(eventId), await getOperationalTimezone());

export class FreeEventLifecycleError extends Error {
  constructor(
    readonly reason: "not_found" | "ended" | "has_registrations" | "open" | "past_date"
  ) {
    super(reason);
    this.name = "FreeEventLifecycleError";
  }
}

export const FREE_EVENT_LIFECYCLE_MESSAGE: Record<FreeEventLifecycleError["reason"], string> = {
  not_found: "No encontré ese evento.",
  ended: ENDED_EVENT_MESSAGE,
  has_registrations: "Este evento tiene inscritas: no se borra, queda en la historia.",
  open: "Está publicado. Ciérralo antes de borrarlo.",
  past_date: "La fecha ya pasó: cámbiala antes de publicar.",
};

/** ¿Otro evento sigue usando este archivo de material? Entonces no se borra. */
const materialBlobInUse = async (url: string, exceptId: string): Promise<boolean> =>
  (await prisma.freeWebinar.count({ where: { materialUrl: url, id: { not: exceptId } } })) > 0;

/**
 * Borra un evento sin inscritas (si tiene, es historia y se queda, como un
 * taller con pagos). Devuelve el material a borrar del almacenamiento si nadie
 * más lo usa.
 */
export const deleteFreeEvent = async (id: string): Promise<{ materialUrl: string | null }> => {
  const row = await prisma.freeWebinar.findUnique({
    where: { id },
    select: { id: true, status: true, materialUrl: true, _count: { select: { registrations: true } } },
  });
  if (!row) throw new FreeEventLifecycleError("not_found");
  if (row._count.registrations > 0) throw new FreeEventLifecycleError("has_registrations");
  if (row.status === "OPEN") throw new FreeEventLifecycleError("open");
  await prisma.freeWebinar.delete({ where: { id } });
  const orphan = row.materialUrl && !(await materialBlobInUse(row.materialUrl, id)) ? row.materialUrl : null;
  return { materialUrl: orphan };
};

/* -------------------------------------------------------------------------
 * Publicar, cerrar, terminar
 * ---------------------------------------------------------------------- */

export class FreeWebinarPublishError extends Error {
  readonly blockers: PublishBlocker[];
  constructor(blockers: PublishBlocker[]) {
    super("not_publishable");
    this.name = "FreeWebinarPublishError";
    this.blockers = blockers;
  }
}

export type PublishResult = {
  webinar: FreeWebinarPublic;
  /** Los que estaban publicados y pasaron a «inscripciones cerradas». */
  closed: { id: string; headline: string }[];
};

/**
 * Publica un evento y cierra las inscripciones del que estuviera publicado,
 * en una transacción — como `closeOtherOpenWorkshops`. El cerrado no se
 * cancela: si aún no pasó, sus inscritas siguen recibiendo los recordatorios.
 *
 * Si alguna fila conserva el nombre heredado `gratuito`, aquí recibe su URL
 * propia: desde ahora `gratuito` es solo el alias del evento abierto.
 */
export const publishFreeEvent = async (
  id: string,
  actor: FreeEventActor = {},
  now: Date = new Date()
): Promise<PublishResult> => {
  const tz = await getOperationalTimezone();
  const row = await prisma.freeWebinar.findUnique({ where: { id } });
  if (!row) throw new FreeEventLifecycleError("not_found");
  if (isFreeEventEnded(row)) throw new FreeEventLifecycleError("ended");
  const pub = toFreeWebinarPublic(row, tz);
  const blockers = getPublishBlockers(pub);
  if (blockers.length > 0) throw new FreeWebinarPublishError(blockers);
  // Reabierto con la fecha ya pasada: publicarlo abriría inscripciones a algo hecho.
  const closeAt = resolveWebinarCloseAt(pub, tz);
  if (closeAt && now >= closeAt) throw new FreeEventLifecycleError("past_date");

  const closed = await prisma.$transaction(async (tx) => {
    // Dos publicaciones a la vez podrían dejar dos abiertos.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('free-event-publish'))`;

    const others = await tx.freeWebinar.findMany({
      where: { status: "OPEN", id: { not: id } },
      select: { id: true, headline: true },
    });
    if (others.length > 0) {
      await tx.freeWebinar.updateMany({
        where: { id: { in: others.map((o) => o.id) } },
        data: { status: "CLOSED", isActive: false },
      });
    }
    // El espejo, por si alguna fila vieja quedó encendida sin estar OPEN.
    await tx.freeWebinar.updateMany({
      where: { isActive: true, status: { not: "OPEN" }, id: { not: id } },
      data: { isActive: false },
    });

    const legacy = await tx.freeWebinar.findMany({
      where: { slug: FREE_EVENT_ALIAS_SLUG },
      select: { id: true, headline: true, startsAt: true },
    });
    for (const l of legacy) {
      const slug = await uniqueFreeEventSlug(slugBaseFor(l, tz), l.id, tx);
      await tx.freeWebinar.update({ where: { id: l.id }, data: { slug } });
    }

    if (row.status !== "OPEN" || !row.isActive) {
      await tx.freeWebinar.update({
        where: { id },
        data: { status: "OPEN", isActive: true, publishedAt: row.publishedAt ?? now },
      });
      const activities: FreeEventActivityInput[] = [
        { freeWebinarId: id, kind: "published", at: now, staffUserId: actor.staffUserId },
        ...others.map(
          (o): FreeEventActivityInput => ({
            freeWebinarId: o.id,
            kind: "closed",
            at: now,
            staffUserId: actor.staffUserId,
            meta: { byEventId: id, byHeadline: row.headline },
          })
        ),
      ];
      await recordFreeEventActivitiesTx(tx, activities);
    }
    return others;
  });

  const fresh = await prisma.freeWebinar.findUniqueOrThrow({ where: { id } });
  return { webinar: toFreeWebinarPublic(fresh, tz), closed };
};

/** Apaga la página: el publicado pasa a «inscripciones cerradas». */
export const unpublishFreeEvent = async (
  id: string,
  actor: FreeEventActor = {}
): Promise<FreeWebinarPublic> => {
  const row = await prisma.freeWebinar.findUniqueOrThrow({ where: { id } });
  const next = statusAfterUnpublish(row.status);
  if (next !== row.status || row.isActive) {
    await prisma.freeWebinar.update({ where: { id }, data: { status: next, isActive: false } });
    if (row.status === "OPEN") {
      await recordFreeEventActivity({ freeWebinarId: id, kind: "unpublished", staffUserId: actor.staffUserId });
    }
  }
  return toFreeWebinarPublic(
    await prisma.freeWebinar.findUniqueOrThrow({ where: { id } }),
    await getOperationalTimezone()
  );
};

/**
 * Da el evento por realizado: corta inscripciones, enlace y recordatorios.
 * Compare-and-swap sobre `endedAt: null`: dos ticks del reloj (o el reloj y
 * Dayana) no pueden terminarlo dos veces ni anotarlo dos veces.
 */
export const endFreeEvent = async (
  id: string,
  opts: FreeEventActor & { by: "cron" | "staff"; now?: Date }
): Promise<boolean> => {
  const now = opts.now ?? new Date();
  const { count } = await prisma.freeWebinar.updateMany({
    where: { id, endedAt: null },
    data: { endedAt: now, status: "COMPLETED", isActive: false },
  });
  if (count === 0) {
    // Terminado de antes sin estado (base vieja): se pone al día sin anotar.
    await prisma.freeWebinar.updateMany({
      where: { id, endedAt: { not: null }, status: { not: "COMPLETED" } },
      data: { status: "COMPLETED", isActive: false },
    });
    return false;
  }
  await recordFreeEventActivity({
    freeWebinarId: id,
    kind: "ended",
    at: now,
    staffUserId: opts.staffUserId,
    meta: { by: opts.by },
  });
  return true;
};

/** Reabrir uno terminado por error: queda sin inscripciones hasta publicarlo. */
export const reopenFreeEvent = async (
  id: string,
  actor: FreeEventActor = {}
): Promise<FreeWebinarPublic> => {
  const row = await prisma.freeWebinar.findUniqueOrThrow({ where: { id } });
  if (row.endedAt || row.status === "COMPLETED") {
    await prisma.freeWebinar.update({
      where: { id },
      data: { endedAt: null, status: statusAfterReopen(row.status), isActive: false },
    });
    await recordFreeEventActivity({ freeWebinarId: id, kind: "reopened", staffUserId: actor.staffUserId });
  }
  return toFreeWebinarPublic(
    await prisma.freeWebinar.findUniqueOrThrow({ where: { id } }),
    await getOperationalTimezone()
  );
};

/** Cerrar o reabrir a mano (el interruptor de antes). Sin id, el actual. */
export const setFreeWebinarEnded = async (
  ended: boolean,
  eventId?: string,
  actor: FreeEventActor = {}
): Promise<FreeWebinarPublic> => {
  const row = await resolveRow(eventId);
  if (!ended) return reopenFreeEvent(row.id, actor);
  await endFreeEvent(row.id, { by: "staff", staffUserId: actor.staffUserId });
  return toFreeWebinarPublic(
    await prisma.freeWebinar.findUniqueOrThrow({ where: { id: row.id } }),
    await getOperationalTimezone()
  );
};

/** Margen tras un evento con hora real antes de darlo por terminado. */
const CLOSE_GRACE_MS = 3 * 60 * 60 * 1000;

/**
 * Cuando se da por terminado un evento.
 *
 * Con hora real: `startsAt` + 3 h. Sin hora, `startsAt` guarda un ancla de
 * mediodia (`DATE_ONLY_ANCHOR_TIME`), no una hora de verdad — sumarle 3 h
 * cerraria a las 15:00 una sesion de las 20:00. En ese caso se cierra a las
 * 03:00 del dia siguiente en la zona operativa, que es configurable, asi que
 * se calcula con la zona y no con un desplazamiento fijo.
 */
export const resolveWebinarCloseAt = (
  webinar: Pick<FreeWebinarPublic, "startsAt" | "startsAtHasTime">,
  timezone: string
): Date | null => {
  if (!webinar.startsAt) return null;
  if (webinar.startsAtHasTime) {
    return new Date(webinar.startsAt.getTime() + CLOSE_GRACE_MS);
  }
  const nextMidnight = getStartOfNextDayInTz(webinar.startsAt, timezone);
  return new Date(nextMidnight.getTime() + 3 * 60 * 60 * 1000);
};

/**
 * Los eventos en pie (publicados o con inscripciones cerradas, sin terminar):
 * los que el reloj atiende — enlace, recordatorios y cierre. Normalmente uno;
 * dos cuando se publica el siguiente antes de que pase el actual.
 */
export const listLiveFreeEvents = async (): Promise<FreeWebinarPublic[]> => {
  const rows = await prisma.freeWebinar.findMany({
    where: {
      endedAt: null,
      OR: [{ status: { in: ["OPEN", "CLOSED"] } }, { isActive: true }],
    },
    orderBy: [{ startsAt: { sort: "asc", nulls: "last" } }],
  });
  const tz = await getOperationalTimezone();
  return rows.filter(freeEventAcceptsReminders).map((r) => toFreeWebinarPublic(r, tz));
};

/**
 * El reloj: termina los que ya pasaron. Devuelve los que terminó ESTE proceso.
 * Uno que Dayana reabrió a mano después de su cierre no se vuelve a terminar
 * solo mientras siga sin publicar: lo reabrió para algo (cambiarle la fecha).
 */
export const closeDueFreeEvents = async (
  now: Date = new Date()
): Promise<FreeWebinarPublic[]> => {
  const tz = await getOperationalTimezone();
  const live = await listLiveFreeEvents();
  const closed: FreeWebinarPublic[] = [];
  for (const e of live) {
    const closeAt = resolveWebinarCloseAt(e, tz);
    if (!closeAt || now < closeAt) continue;
    // Uno publicado que ya pasó se termina siempre: seguiría aceptando inscripciones.
    if (e.status !== "OPEN") {
      const reopened = await prisma.freeEventActivity.findFirst({
        where: { freeWebinarId: e.id, kind: "reopened", at: { gte: closeAt } },
        select: { id: true },
      });
      if (reopened) continue;
    }
    if (await endFreeEvent(e.id, { by: "cron", now })) {
      const fresh = await prisma.freeWebinar.findUniqueOrThrow({ where: { id: e.id } });
      closed.push(toFreeWebinarPublic(fresh, tz));
    }
  }
  return closed;
};

/* -------------------------------------------------------------------------
 * Editar
 * ---------------------------------------------------------------------- */

export type FreeWebinarUpdateResult = {
  webinar: FreeWebinarPublic;
  /** El enlace quedó distinto al guardado → hay que reenviarlo a todas. */
  meetUrlChanged: boolean;
  /** Se reprogramó → los recordatorios ya enviados dejan de valer. */
  startsAtChanged: boolean;
  /** Registros que vuelven a la cola del enlace por el cambio. */
  linkEmailsReset: number;
  /** Al publicar: los que estaban publicados y cerraron inscripciones. */
  closedOthers: { id: string; headline: string }[];
};

const PASSTHROUGH_KEYS = [
  "eventLabel",
  "locationLabel",
  "priceLabel",
  "faqTitle",
  "materialLabel",
  "successMessage",
  "linkEnabled",
  "linkTitle",
  "linkSubtitle",
  "waConfirmationEnabled",
] as const;

/**
 * Guarda la página de un evento (sin id, el actual). `isActive: true` lo
 * publica (y cierra el que estuviera publicado); `false` cierra inscripciones.
 */
export const updateFreeWebinar = async (
  input: FreeWebinarUpdateInput,
  eventId?: string,
  actor: FreeEventActor = {}
): Promise<FreeWebinarUpdateResult> => {
  const current = await resolveRow(eventId);
  const id = current.id;
  const tz = await getOperationalTimezone();

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
  // Antes del update: asignarlo después no lo guardaba nunca.
  if (input.capacity !== undefined) data.capacity = input.capacity;
  for (const key of PASSTHROUGH_KEYS) {
    if (input[key] !== undefined) {
      (data as Record<string, unknown>)[key] = input[key];
    }
  }

  const startsAtChanged =
    schedule !== undefined &&
    (schedule.startsAt?.getTime() ?? null) !==
      (current.startsAt?.getTime() ?? null);

  // Uno que ya pasó no se reprograma ni cambia de enlace: haría lo mismo que
  // en uno vivo —borrar los sellos de sus inscritas y mandarles el enlace
  // nuevo—, y sus inscritas son historia. Los textos sí se pueden corregir.
  // Se compara con lo guardado: el panel reenvía la fecha y el enlace tal
  // cual en cada guardado.
  if (isFreeEventEnded(current)) {
    const hasTimeChanged =
      schedule !== undefined && schedule.startsAt !== null && schedule.startsAtHasTime !== current.startsAtHasTime;
    const meetChanged =
      input.meetUrl !== undefined && normalizeMeetUrl(input.meetUrl) !== (current.meetUrl ?? null);
    if (startsAtChanged || hasTimeChanged || meetChanged) {
      throw new FreeEventLifecycleError("ended");
    }
  }

  const nextHeadline = typeof data.headline === "string" ? data.headline : current.headline;
  const nextStartsAt = schedule !== undefined ? schedule.startsAt : current.startsAt;

  if (input.isActive === true) {
    const preview = toFreeWebinarPublic(
      {
        ...current,
        headline: nextHeadline,
        subheadline:
          data.subheadline === undefined
            ? current.subheadline
            : (data.subheadline as string | null),
        body:
          data.body === undefined ? current.body : (data.body as string | null),
        startsAt: nextStartsAt,
        startsAtHasTime:
          schedule !== undefined ? schedule.startsAtHasTime : current.startsAtHasTime,
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
    if (isFreeEventEnded(current)) throw new FreeEventLifecycleError("ended");
  }

  // La URL sigue al titular y a la fecha mientras el evento no se ha
  // publicado nunca; desde que tiene página pública ya no se mueve sola.
  if (
    !current.publishedAt &&
    !isReservedFreeEventSlug(current.slug) &&
    (nextHeadline !== current.headline || startsAtChanged)
  ) {
    const base = slugBaseFor({ headline: nextHeadline, startsAt: nextStartsAt }, tz);
    if (!current.slug.startsWith(base)) data.slug = await uniqueFreeEventSlug(base, id);
  }

  const row = await prisma.freeWebinar.update({ where: { id }, data });

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
        ? { id, meetUrl: { not: null } }
        : { id, OR: [{ meetUrl: null }, { meetUrl: { not: next } }] };
    const { count } = await prisma.freeWebinar.updateMany({
      where,
      data: { meetUrl: next },
    });
    meetUrlChanged = count > 0;
    if (meetUrlChanged && next !== null) {
      linkEmailsReset = await resetLinkEmails(row.id);
      await recordFreeEventActivity({
        freeWebinarId: id,
        kind: current.meetUrl ? "meet_link_changed" : "meet_link_set",
        count: linkEmailsReset || null,
        staffUserId: actor.staffUserId,
      });
    }
  }

  // Reprogramar sin esto dejaría los recordatorios sellados de la fecha
  // anterior: nadie recibiría aviso de la nueva.
  if (startsAtChanged) {
    await resetReminders(row.id);
    const fresh = toFreeWebinarPublic(row, tz);
    await recordFreeEventActivity({
      freeWebinarId: id,
      kind: "date_changed",
      staffUserId: actor.staffUserId,
      meta: {
        from: current.startsAt?.toISOString() ?? null,
        to: row.startsAt?.toISOString() ?? null,
        label: formatWebinarScheduleLabel(fresh),
      },
    });
  }

  let closedOthers: PublishResult["closed"] = [];
  if (input.isActive === true) {
    closedOthers = (await publishFreeEvent(id, actor)).closed;
  } else if (input.isActive === false) {
    await unpublishFreeEvent(id, actor);
  }

  const finalRow = await prisma.freeWebinar.findUniqueOrThrow({ where: { id } });
  return {
    webinar: toFreeWebinarPublic(finalRow, tz),
    meetUrlChanged,
    startsAtChanged,
    linkEmailsReset,
    closedOthers,
  };
};

export const clearFreeWebinarSchedule = async (
  eventId?: string,
  actor: FreeEventActor = {}
): Promise<FreeWebinarPublic> =>
  (await updateFreeWebinar({ isActive: false, startsAt: null }, eventId, actor)).webinar;

/** Volver a los textos de ejemplo, sin fecha y en borrador. */
export const resetFreeWebinar = async (
  eventId?: string,
  actor: FreeEventActor = {}
): Promise<FreeWebinarPublic> => {
  const current = await resolveRow(eventId);
  // Volver a cero borra fecha, enlace y sellos: en uno que ya pasó, no.
  if (isFreeEventEnded(current)) throw new FreeEventLifecycleError("ended");
  if (current.status === "OPEN") await unpublishFreeEvent(current.id, actor);
  const row = await prisma.freeWebinar.update({
    where: { id: current.id },
    data: {
      isActive: false,
      ...(current.endedAt ? {} : { status: "DRAFT" as const }),
      ...defaultTemplate(),
      startsAt: null,
      startsAtHasTime: false,
      meetUrl: null,
      videoUrl: null,
      ...CLEARED_VIDEO_FIELDS,
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
  eventId?: string
): Promise<{ uploadUrl: string; uploadId: string; eventId: string }> => {
  const row = await resolveRow(eventId);
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
    where: { id: row.id },
    data: {
      ...CLEARED_VIDEO_FIELDS,
      muxUploadId: created.id,
      videoStatus: RecordingStatus.UPLOADING,
    },
  });

  return { uploadUrl: created.url, uploadId: created.id, eventId: row.id };
};

export const clearWebinarVideo = async (
  eventId?: string
): Promise<FreeWebinarPublic> => {
  const current = await resolveRow(eventId);
  const row = await prisma.freeWebinar.update({
    where: { id: current.id },
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
  eventId?: string
): Promise<FreeWebinarPublic> => {
  const tz = await getOperationalTimezone();
  const row = await resolveRow(eventId);

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

  const fresh = await prisma.freeWebinar.findUniqueOrThrow({ where: { id: row.id } });
  return toFreeWebinarPublic(fresh, tz);
};

/* -------------------------------------------------------------------------
 * Material descargable (opcional)
 *
 * Un solo adjunto por evento, guardado en columnas de la propia fila. Es
 * opcional a proposito y NO entra en `getPublishBlockers`. Copiar la página de
 * un evento comparte el archivo: por eso solo se devuelve la URL vieja para
 * borrarla si ningún otro evento la usa.
 * ---------------------------------------------------------------------- */

export type WebinarMaterialInput = {
  url: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
};

/** Guarda el material y devuelve la URL del anterior si ya nadie la usa. */
export const setWebinarMaterial = async (
  input: WebinarMaterialInput,
  eventId?: string,
  actor: FreeEventActor = {}
): Promise<{ webinar: FreeWebinarPublic; previousUrl: string | null }> => {
  const tz = await getOperationalTimezone();
  const current = await resolveRow(eventId);
  const row = await prisma.freeWebinar.update({
    where: { id: current.id },
    data: {
      materialUrl: input.url,
      materialFileName: input.fileName,
      materialMimeType: input.mimeType,
      materialSizeBytes: input.sizeBytes,
    },
  });
  await recordFreeEventActivity({
    freeWebinarId: row.id,
    kind: "material_uploaded",
    staffUserId: actor.staffUserId,
    meta: { fileName: input.fileName },
  });
  const previousUrl =
    current.materialUrl && !(await materialBlobInUse(current.materialUrl, row.id))
      ? current.materialUrl
      : null;
  return { webinar: toFreeWebinarPublic(row, tz), previousUrl };
};

export const clearWebinarMaterial = async (
  eventId?: string
): Promise<{ webinar: FreeWebinarPublic; previousUrl: string | null }> => {
  const tz = await getOperationalTimezone();
  const current = await resolveRow(eventId);
  const row = await prisma.freeWebinar.update({
    where: { id: current.id },
    data: {
      materialUrl: null,
      materialFileName: null,
      materialMimeType: null,
      materialSizeBytes: null,
    },
  });
  const previousUrl =
    current.materialUrl && !(await materialBlobInUse(current.materialUrl, row.id))
      ? current.materialUrl
      : null;
  return { webinar: toFreeWebinarPublic(row, tz), previousUrl };
};

/**
 * El evento al que va una inscripción: el pedido (`freeEventId` del
 * formulario) si sigue abierto; si no, el abierto de ahora. Un formulario
 * cacheado del evento anterior no inscribe a nadie en algo que ya cerró.
 */
export const resolveRegistrationEvent = async (
  requestedId?: string | null
): Promise<FreeWebinarPublic | null> => {
  const requested = requestedId ? await getFreeEventById(requestedId).catch(() => null) : null;
  const open = requested && isFreeEventOpenRow(requested) ? null : await getOpenFreeEvent();
  return resolveRegistrationTarget(requested, open);
};
