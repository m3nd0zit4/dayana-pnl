import type { FreeWebinar, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  OPERATIONAL_TZ,
  getDateKeyInTz,
  getTimeHmInTz,
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
  videoUrl: string | null;
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
  videoUrl?: string | null;
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

export const toFreeWebinarPublic = (row: FreeWebinar): FreeWebinarPublic => {
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
    startsAtDateKey: startsAt ? getDateKeyInTz(startsAt, OPERATIONAL_TZ) : null,
    startsAtTimeHm:
      startsAt && startsAtHasTime
        ? getTimeHmInTz(startsAt, OPERATIONAL_TZ)
        : null,
    startsAtHasTime,
    operationalTimezone: OPERATIONAL_TZ,
    videoUrl: row.videoUrl,
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
  videoUrl: null as string | null,
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

const resolveSchedule = (
  input: FreeWebinarUpdateInput
): ResolvedSchedule | undefined => {
  if (input.startsAtLocal === null) {
    return { startsAt: null, startsAtHasTime: false };
  }
  if (input.startsAtLocal !== undefined) {
    const time = input.startsAtLocal.time?.trim() ?? "";
    const hasTime = /^\d{1,2}:\d{2}$/.test(time);
    return {
      startsAt: zonedDateTimeToUtc(
        input.startsAtLocal.date,
        hasTime ? time : DATE_ONLY_ANCHOR_TIME,
        OPERATIONAL_TZ
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
    return undefined; // flag alone is not enough without a date
  }
  return undefined;
};

export const getFreeWebinar = async (
  slug: string = FREE_WEBINAR_SLUG
): Promise<FreeWebinarPublic | null> => {
  const row = await prisma.freeWebinar.findUnique({ where: { slug } });
  return row ? toFreeWebinarPublic(row) : null;
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
  const existing = await prisma.freeWebinar.findUnique({ where: { slug } });
  if (existing) return toFreeWebinarPublic(existing);

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
  return toFreeWebinarPublic(created);
};

export class FreeWebinarPublishError extends Error {
  readonly blockers: PublishBlocker[];
  constructor(blockers: PublishBlocker[]) {
    super("not_publishable");
    this.name = "FreeWebinarPublishError";
    this.blockers = blockers;
  }
}

export const updateFreeWebinar = async (
  input: FreeWebinarUpdateInput,
  slug: string = FREE_WEBINAR_SLUG
): Promise<FreeWebinarPublic> => {
  await ensureFreeWebinar(slug);

  const data: Prisma.FreeWebinarUpdateInput = {};
  if (input.headline !== undefined) data.headline = input.headline;
  if (input.subheadline !== undefined) data.subheadline = input.subheadline;
  if (input.body !== undefined) data.body = input.body;
  const schedule = resolveSchedule(input);
  if (schedule !== undefined) {
    data.startsAt = schedule.startsAt;
    data.startsAtHasTime = schedule.startsAtHasTime;
  }
  if (input.videoUrl !== undefined) data.videoUrl = input.videoUrl;
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

  if (input.isActive === true) {
    const current = await prisma.freeWebinar.findUniqueOrThrow({
      where: { slug },
    });
    const nextStartsAt =
      schedule !== undefined ? schedule.startsAt : current.startsAt;
    const nextHasTime =
      schedule !== undefined
        ? schedule.startsAtHasTime
        : current.startsAtHasTime;
    const preview = toFreeWebinarPublic({
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
        typeof data.formTitle === "string" ? data.formTitle : current.formTitle,
    });
    const blockers = getPublishBlockers(preview);
    if (blockers.length > 0) {
      throw new FreeWebinarPublishError(blockers);
    }
  }

  const row = await prisma.freeWebinar.update({
    where: { slug },
    data,
  });
  return toFreeWebinarPublic(row);
};

export const clearFreeWebinarSchedule = async (
  slug: string = FREE_WEBINAR_SLUG
): Promise<FreeWebinarPublic> =>
  updateFreeWebinar({ isActive: false, startsAt: null }, slug);

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
  return toFreeWebinarPublic(row);
};
