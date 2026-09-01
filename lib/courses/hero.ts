import { prisma } from "@/lib/db";

/**
 * El hero de `/cursos`, editable sin desplegar.
 *
 * Nace de un problema concreto: la página tenía que abrir con algo —una
 * invitación de Dayana en vídeo, una foto, una oferta— y ese material no
 * existía todavía. Escribirlo en el código habría significado un despliegue
 * cada vez que cambie una campaña, así que vive en `SiteSetting`.
 *
 * **Sin ninguna fila la página se sirve igual de bien**, con el titular de
 * texto que ya tenía. Nada aquí es obligatorio y nada rompe si falta: un
 * `playbackId` a medio configurar cae a la imagen, y sin imagen cae al texto.
 *
 * El vídeo va con playback policy **`public`**, como el promo del webinar y a
 * diferencia de las grabaciones de clase, que son `signed`. Es material de
 * marketing servido a desconocidos: firmarlo obligaría a una ruta de token
 * para no proteger nada.
 */

export const COURSES_HERO_KEYS = {
  kind: "courses_hero_kind",
  playbackId: "courses_hero_playback_id",
  imageUrl: "courses_hero_image_url",
  eyebrow: "courses_hero_eyebrow",
  title: "courses_hero_title",
  subtitle: "courses_hero_subtitle",
  offerLabel: "courses_hero_offer_label",
  offerUntil: "courses_hero_offer_until",
} as const;

export type CoursesHero = {
  /** `null` cuando no hay ni vídeo ni imagen: el hero se queda en tipografía. */
  media: { kind: "video"; playbackId: string } | { kind: "image"; url: string } | null;
  eyebrow: string | null;
  /** Los saltos de línea son intencionados: `SplitReveal` anima por línea. */
  title: string | null;
  subtitle: string | null;
  /** Sólo si sigue viva. Una oferta caducada no se pinta, se ignora. */
  offer: { label: string; until: Date | null } | null;
};

const clean = (value: string | null | undefined): string | null => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
};

export const getCoursesHero = async (): Promise<CoursesHero> => {
  const keys = Object.values(COURSES_HERO_KEYS);
  const rows = await prisma.siteSetting
    .findMany({ where: { key: { in: [...keys] } }, select: { key: true, value: true } })
    .catch(() => []);
  const map = new Map(rows.map((r) => [r.key, r.value]));
  const get = (key: string) => clean(map.get(key));

  const playbackId = get(COURSES_HERO_KEYS.playbackId);
  const imageUrl = get(COURSES_HERO_KEYS.imageUrl);
  // `kind` sólo desempata cuando hay las dos cosas guardadas; lo que decide de
  // verdad es qué existe, para que un `kind: "video"` olvidado tras borrar el
  // playback no deje el hero en blanco.
  const preferVideo = get(COURSES_HERO_KEYS.kind) !== "image";

  const media: CoursesHero["media"] =
    playbackId && (preferVideo || !imageUrl)
      ? { kind: "video", playbackId }
      : imageUrl
        ? { kind: "image", url: imageUrl }
        : null;

  const offerLabel = get(COURSES_HERO_KEYS.offerLabel);
  const rawUntil = get(COURSES_HERO_KEYS.offerUntil);
  const until = rawUntil ? new Date(rawUntil) : null;
  const validUntil = until && !Number.isNaN(until.getTime()) ? until : null;
  // Una oferta con fecha pasada desaparece sola. Es la diferencia entre que se
  // le olvide a alguien retirarla y que la web siga prometiendo un descuento
  // que ya no se aplica en el cobro.
  const offerLive = offerLabel != null && (validUntil == null || validUntil > new Date());

  return {
    media,
    eyebrow: get(COURSES_HERO_KEYS.eyebrow),
    title: get(COURSES_HERO_KEYS.title),
    subtitle: get(COURSES_HERO_KEYS.subtitle),
    offer: offerLive && offerLabel ? { label: offerLabel, until: validUntil } : null,
  };
};
