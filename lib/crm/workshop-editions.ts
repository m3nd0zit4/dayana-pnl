import { EnrollmentStatus, Prisma, WorkshopEditionStatus, type WorkshopEdition } from "@prisma/client";
import { workshopProductIdFor } from "./workshop-price-rows";
import { enrichWorkshopInput } from "./workshop-enrichment";
import { recordWorkshopActivity } from "./workshop-activity";
import { applyWorkshopStatus, WorkshopLifecycleError, type WorkshopActor } from "./workshop-lifecycle";
import { normalizeWorkshopSchedule } from "../workshop-schedule";
import { getOperationalTimezone } from "./operational-timezone";
import { prisma } from "../db";
import { crmEditionWhere } from "../workshops-db";
import { uniqueSlug } from "./slug";
export type WorkshopEditionInput = {
  slug?: string;
  title: string;
  editionLabel?: string | null;
  cardSummary?: string | null;
  /**
   * El estado lo cambian los pasos del ciclo (`workshop-lifecycle.ts`). Si
   * llega aquí (el asistente), se aplica con esos mismos pasos.
   */
  status?: WorkshopEditionStatus;
  dateLabel?: string | null;
  scheduleLabel?: string | null;
  capacity?: number | null;
  whatsappTemplate?: string | null;
  startsAt?: Date | null;
  /** false = solo el día (la hora de `startsAt` es un ancla). */
  startsAtHasTime?: boolean;
  timezone?: string | null;
  productId?: string | null;
  heroLine1?: string | null;
  heroLine2?: string | null;
  heroLine3?: string | null;
  detailSummary?: string | null;
  intro?: string | null;
  focusTopics?: string[] | null;
  daySchedule?: { startTime: string; endTime: string; title: string; time?: string }[] | null;
  topicsSectionTitle?: string | null;
  topicsSectionDescription?: string | null;
  scheduleSectionDescription?: string | null;
  metaTitle?: string | null;
  metaDescription?: string | null;
  introOpen?: string | null;
  /** `undefined` = no tocar (el asistente no lo envia). */
  meetingUrl?: string | null;
};

/** Lo que el enriquecido deriva del título y la descripción. */
const derivedData = (enriched: WorkshopEditionInput) => ({
  title: enriched.title,
  cardSummary: enriched.cardSummary ?? null,
  detailSummary: enriched.detailSummary ?? null,
  intro: enriched.intro ?? null,
  heroLine1: enriched.heroLine1 ?? null,
  heroLine2: enriched.heroLine2 ?? null,
  heroLine3: enriched.heroLine3 ?? null,
  whatsappTemplate: enriched.whatsappTemplate ?? null,
  topicsSectionTitle: enriched.topicsSectionTitle ?? null,
  topicsSectionDescription: enriched.topicsSectionDescription ?? null,
  scheduleSectionDescription: enriched.scheduleSectionDescription ?? null,
  metaTitle: enriched.metaTitle ?? null,
  metaDescription: enriched.metaDescription ?? null,
  introOpen: enriched.introOpen ?? null,
});

/** Una lista vacía o `null` borra; `undefined` no toca. */
const jsonList = <T>(v: T[] | null | undefined): T[] | undefined => (v === undefined ? undefined : (v ?? []));

const editionCreateData = (input: WorkshopEditionInput) => ({
  ...derivedData(input),
  editionLabel: input.editionLabel ?? null,
  dateLabel: input.dateLabel ?? null,
  scheduleLabel: input.scheduleLabel ?? null,
  capacity: input.capacity ?? null,
  startsAt: input.startsAt ?? null,
  startsAtHasTime: input.startsAtHasTime ?? true,
  timezone: input.timezone ?? "America/Bogota",
  focusTopics: jsonList(input.focusTopics),
  daySchedule: input.daySchedule ? normalizeWorkshopSchedule(input.daySchedule) : undefined,
  meetingUrl: input.meetingUrl || null,
});

/**
 * Prisma update fragment for the product relation: undefined = leave the
 * existing link untouched, null/"" = disconnect, id = connect. Shared by
 * both write paths so the omitted/null/id contract can't drift.
 */
const productRelationUpdate = (productId: string | null | undefined) =>
  productId !== undefined
    ? productId
      ? { product: { connect: { id: productId } } }
      : { product: { disconnect: true as const } }
    : {};

/** Lo que no viene se queda como estaba. */
const keep = <T>(next: T | undefined, prev: T): T => (next === undefined ? prev : next);

/**
 * Cambiar la fecha deja sin valor los recordatorios ya enviados: vuelven a la
 * cola (correo y WhatsApp), como al reprogramar un evento.
 */
export const resetWorkshopReminders = (workshopEditionId: string) =>
  prisma.enrollment.updateMany({
    where: { workshopEditionId },
    data: {
      workshopReminder24hSentAt: null,
      workshopReminder1hSentAt: null,
      workshopReminder24hWaSentAt: null,
      workshopReminder1hWaSentAt: null,
      workshopWaReminderError: null,
      workshopWaReminder1hError: null,
      workshopWaReminderErrorAt: null,
    },
  });

const dateLabelFor = (d: Date | null, tz: string) =>
  d ? d.toLocaleString("es-CO", { timeZone: tz, dateStyle: "long", timeStyle: "short" }) : "sin fecha";

/**
 * Anota lo que cambió de verdad (fecha, enlace) y devuelve los recordatorios
 * a la cola: con otra fecha los enviados dejan de valer, y con otro enlace
 * —si el taller aún no empezó— llevaban la sala vieja. Como en los eventos,
 * esa vuelta a la cola es el reenvío.
 */
const recordEditChanges = async (
  before: Pick<WorkshopEdition, "id" | "startsAt" | "startsAtHasTime" | "meetingUrl" | "timezone">,
  after: Pick<WorkshopEdition, "startsAt" | "startsAtHasTime" | "meetingUrl" | "timezone">,
  actor: WorkshopActor
) => {
  const startsBefore = before.startsAt?.getTime() ?? null;
  const startsAfter = after.startsAt?.getTime() ?? null;
  const dateChanged = startsBefore !== startsAfter || before.startsAtHasTime !== after.startsAtHasTime;
  if (dateChanged) {
    const { count } = await resetWorkshopReminders(before.id);
    await recordWorkshopActivity({
      workshopEditionId: before.id,
      kind: "date_changed",
      staffUserId: actor.staffUserId,
      meta: {
        startsAtIso: after.startsAt?.toISOString() ?? null,
        label: dateLabelFor(after.startsAt, after.timezone),
        remindersReset: count,
      },
    });
  }
  if ((before.meetingUrl ?? null) !== (after.meetingUrl ?? null)) {
    const notStarted = !after.startsAt || after.startsAt.getTime() > Date.now();
    // Con la fecha cambiada ya volvieron a la cola.
    const reset = notStarted && !dateChanged && before.meetingUrl ? (await resetWorkshopReminders(before.id)).count : 0;
    await recordWorkshopActivity({
      workshopEditionId: before.id,
      kind: before.meetingUrl ? "meeting_link_changed" : "meeting_link_set",
      staffUserId: actor.staffUserId,
      meta: { ...(after.meetingUrl ? {} : { removed: true }), ...(reset ? { remindersReset: reset } : {}) },
    });
  }
};

/**
 * El producto propio de la edición (`taller-<slug>`) con su título y su
 * estado: se cobra con ese nombre (checkout, recibos, correos) y solo se vende
 * publicada. Nunca crea uno ni toca un paquete compartido heredado.
 */
const alignOwnProduct = (edition: Pick<WorkshopEdition, "slug" | "title" | "status" | "endedAt">) =>
  prisma.product.updateMany({
    where: { id: workshopProductIdFor(edition.slug) },
    data: {
      title: edition.title,
      isActive: edition.status === WorkshopEditionStatus.OPEN && !edition.endedAt,
    },
  });

/**
 * Alta (o reescritura) de una edición con un slug dado. La usa el asistente
 * (`create_workshop`): nace en borrador y, si pide un estado, se aplica con
 * los pasos del ciclo.
 */
export const upsertWorkshopEdition = async (
  slug: string,
  input: WorkshopEditionInput,
  actor: WorkshopActor = {}
): Promise<WorkshopEdition> => {
  const existing = await prisma.workshopEdition.findUnique({ where: { slug }, select: { id: true } });
  if (existing) return updateWorkshopEditionBySlug(slug, input, actor);

  const enriched = enrichWorkshopInput(input);
  const created = await prisma.workshopEdition.create({
    data: {
      slug,
      status: WorkshopEditionStatus.DRAFT,
      ...editionCreateData(enriched),
      ...(enriched.productId ? { product: { connect: { id: enriched.productId } } } : {}),
    },
  });
  await recordWorkshopActivity({
    workshopEditionId: created.id,
    kind: "created",
    at: created.createdAt,
    staffUserId: actor.staffUserId,
  });
  if (input.status && input.status !== WorkshopEditionStatus.DRAFT) {
    await applyWorkshopStatus(created.id, input.status, actor);
  }
  return prisma.workshopEdition.findUniqueOrThrow({ where: { id: created.id } });
};

/**
 * Guarda una edición. Lo que no viene (`undefined`) se queda como estaba —
 * antes cada guardado borraba el cupo, las etiquetas y la fecha que el
 * formulario no enviaba. Los textos derivados (cabecera, SEO, mensaje de
 * WhatsApp) se recalculan con el título y la descripción, como siempre.
 */
export const updateWorkshopEditionBySlug = async (
  slug: string,
  input: WorkshopEditionInput,
  actor: WorkshopActor = {}
): Promise<WorkshopEdition> => {
  const existing = await prisma.workshopEdition.findUniqueOrThrow({ where: { slug } });

  // La descripción: la que llega o la guardada. Vacía se queda vacía (no se
  // rellena con el título: publicar la pide).
  const description =
    input.cardSummary !== undefined
      ? input.cardSummary?.trim() || input.detailSummary?.trim() || input.intro?.trim() || ""
      : existing.cardSummary?.trim() || existing.detailSummary?.trim() || existing.intro?.trim() || "";
  const enriched = enrichWorkshopInput({
    ...input,
    cardSummary: description || null,
    detailSummary: null,
    intro: null,
    topicsSectionTitle: keep(input.topicsSectionTitle, existing.topicsSectionTitle),
    introOpen: keep(input.introOpen, existing.introOpen),
  });
  const derived = derivedData(enriched);
  if (!description) {
    Object.assign(derived, {
      cardSummary: null,
      detailSummary: null,
      intro: null,
      metaDescription: input.metaDescription?.trim() || null,
    });
  }

  const meetingUrl = input.meetingUrl === undefined ? existing.meetingUrl : input.meetingUrl || null;
  const edition = await prisma.workshopEdition.update({
    where: { slug },
    data: {
      ...derived,
      editionLabel: keep(input.editionLabel, existing.editionLabel),
      dateLabel: keep(input.dateLabel, existing.dateLabel),
      scheduleLabel: keep(input.scheduleLabel, existing.scheduleLabel),
      capacity: keep(input.capacity, existing.capacity),
      startsAt: keep(input.startsAt, existing.startsAt),
      startsAtHasTime: keep(input.startsAtHasTime, existing.startsAtHasTime),
      timezone: input.timezone ?? existing.timezone,
      focusTopics: jsonList(input.focusTopics),
      daySchedule: input.daySchedule === undefined ? undefined : normalizeWorkshopSchedule(input.daySchedule ?? []),
      meetingUrl,
      ...productRelationUpdate(input.productId),
    },
  });
  await recordEditChanges(existing, edition, actor);
  await alignOwnProduct(edition);

  if (input.status !== undefined && input.status !== edition.status) {
    await applyWorkshopStatus(edition.id, input.status, actor);
    return prisma.workshopEdition.findUniqueOrThrow({ where: { id: edition.id } });
  }
  return edition;
};

/* -------------------------------------------------------------------------
 * «Nuevo taller» y «Duplicar»
 * ---------------------------------------------------------------------- */

/**
 * ¿La URL está libre? Ni la usa otra edición (hoy o antes de un cambio de
 * URL), ni queda un producto `taller-<slug>` de un taller borrado: la edición
 * nueva lo adoptaría al ponerle precio, con precios y matrículas ajenas.
 */
const isNewWorkshopSlugTaken = async (slug: string): Promise<boolean> =>
  (await isWorkshopSlugInUse(slug)) ||
  Boolean(await prisma.product.findUnique({ where: { id: workshopProductIdFor(slug) }, select: { id: true } }));

export type CreateWorkshopEditionInput = {
  title?: string | null;
  startsAt?: Date | null;
  /** false = solo el día. */
  startsAtHasTime?: boolean;
  /** Copiar la página (textos, temas, cronograma, cupo) de otra edición. */
  copyFromId?: string | null;
};

/**
 * Una edición nueva, en borrador, como «Nuevo evento». La copia hereda la
 * página y nunca los hechos de la edición: ni la fecha, ni el precio, ni las
 * inscritas, ni los documentos, ni el enlace de la reunión (heredarlo haría
 * que el recordatorio llevara a la sala de otra fecha).
 */
export const createWorkshopEdition = async (
  input: CreateWorkshopEditionInput = {},
  actor: WorkshopActor = {}
): Promise<WorkshopEdition> => {
  const source = input.copyFromId
    ? await prisma.workshopEdition.findUnique({ where: { id: input.copyFromId } })
    : null;
  if (input.copyFromId && !source) throw new WorkshopLifecycleError("not_found");

  const tz = source?.timezone ?? (await getOperationalTimezone());
  const title = input.title?.trim() || source?.title || "Nuevo taller";
  const description = source ? source.cardSummary?.trim() || source.detailSummary?.trim() || "" : "";
  // Sin descripción no se inventa una con el título: publicar la pedirá.
  const derived = enrichWorkshopInput({
    title,
    cardSummary: description || null,
    topicsSectionTitle: source?.topicsSectionTitle ?? null,
    introOpen: source?.introOpen ?? null,
    metaDescription: source && description ? source.metaDescription : null,
  });
  const page = {
    ...derivedData(derived),
    ...(description ? {} : { cardSummary: null, detailSummary: null, intro: null, metaDescription: null }),
    topicsSectionDescription: source?.topicsSectionDescription ?? null,
    scheduleSectionDescription: source?.scheduleSectionDescription ?? null,
    scheduleLabel: source?.scheduleLabel ?? null,
    capacity: source?.capacity ?? null,
    focusTopics: (source?.focusTopics ?? undefined) as Prisma.InputJsonValue | undefined,
    daySchedule: (source?.daySchedule ?? undefined) as Prisma.InputJsonValue | undefined,
  };

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const slug = await uniqueSlug(title, isNewWorkshopSlugTaken);
    try {
      const row = await prisma.workshopEdition.create({
        data: {
          ...page,
          slug,
          status: WorkshopEditionStatus.DRAFT,
          startsAt: input.startsAt ?? null,
          startsAtHasTime: input.startsAtHasTime ?? true,
          timezone: tz,
          meetingUrl: null,
        },
      });
      await recordWorkshopActivity({
        workshopEditionId: row.id,
        kind: "created",
        at: row.createdAt,
        staffUserId: actor.staffUserId,
        meta: source ? { copiedFromId: source.id, copiedFromTitle: source.title } : null,
      });
      return row;
    } catch (e) {
      // Dos altas a la vez eligieron la misma URL: el índice decide y la
      // segunda prueba la siguiente.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") continue;
      throw e;
    }
  }
  throw new Error("workshop_slug_race");
};

/** «Duplicar»: un borrador nuevo con la página de esta edición. */
export const duplicateWorkshopEdition = (id: string, actor: WorkshopActor = {}) =>
  createWorkshopEdition({ copyFromId: id }, actor);

/** Same filter/order the admin workshops list route uses — every real edition, newest first, excluding the virtual "proximo-taller" placeholder. */
export const listWorkshopEditionsAdmin = async () =>
  prisma.workshopEdition.findMany({
    where: crmEditionWhere,
    orderBy: { createdAt: "desc" },
  });

export const getWorkshopEditionBySlug = async (slug: string) =>
  prisma.workshopEdition.findUnique({
    where: { slug },
    include: { product: { include: { prices: true } } },
  });

/** Same slug-generation the admin create route uses (app/api/admin/workshops/route.ts) — collision-checked against real WorkshopEdition rows. */
/**
 * ¿La usa ya alguna edición, hoy o antes de un cambio de URL? Una URL vieja
 * sigue redirigiendo a su edición, así que no se puede dar a otra.
 */
export const isWorkshopSlugInUse = async (slug: string): Promise<boolean> =>
  !!(await prisma.workshopEdition.findFirst({
    where: { OR: [{ slug }, { previousSlugs: { has: slug } }] },
    select: { id: true },
  }));

/** ¿Es la URL vieja de alguna edición? */
export const isRetiredWorkshopSlug = async (slug: string): Promise<boolean> =>
  !!(await prisma.workshopEdition.findFirst({
    where: { previousSlugs: { has: slug } },
    select: { id: true },
  }));

/**
 * La URL de una edición nueva (la usa el asistente): libre de verdad, sin
 * chocar con un `taller-<slug>` que haya quedado de un taller borrado.
 */
export const generateWorkshopSlug = async (title: string) => uniqueSlug(title, isNewWorkshopSlugTaken);

export const listWorkshopDocuments = (workshopEditionId: string) =>
  prisma.workshopDocument.findMany({
    where: { workshopEditionId },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  });

/** WorkshopDetail (the public DTO) only carries a slug, not the edition's
 *  id — resolve it here rather than threading a new field through that type. */
export const listWorkshopDocumentsBySlug = async (slug: string) => {
  const edition = await prisma.workshopEdition.findUnique({
    where: { slug },
    select: { id: true },
  });
  return edition ? listWorkshopDocuments(edition.id) : [];
};

export const createWorkshopDocument = (input: {
  workshopEditionId: string;
  url: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
}) => prisma.workshopDocument.create({ data: input });

export const deleteWorkshopDocument = async (id: string) => {
  const doc = await prisma.workshopDocument.findUnique({ where: { id } });
  if (!doc) return null;
  await prisma.workshopDocument.delete({ where: { id } });
  return doc;
};

/**
 * Precio por edición, para el panel.
 *
 * `rows` debe venir ordenado por `validFrom` descendente (igual que en
 * `workshop-pricing.ts`): la primera fila de cada moneda es la vigente, el
 * resto es histórico y no debe leerse aquí.
 */
export type EditionPrices = { cop: number | null; usd: number | null };

export const latestPricesFromRows = (
  rows: { currency: string; amountMinor: number }[]
): EditionPrices => ({
  cop: rows.find((r) => r.currency === "COP")?.amountMinor ?? null,
  usd: rows.find((r) => r.currency === "USD")?.amountMinor ?? null,
});

/**
 * `priceCop`/`priceUsd` tal como llegan del body crudo de la API (no pasan
 * por el esquema zod de la edición porque son campos nuevos y ese esquema es
 * compartido). Un valor ausente, vacío o inválido se ignora — no cambia el
 * precio — en vez de fallar la petición entera.
 */
/**
 * `undefined` si no se envio (no cambia nada); `NaN` si se envio algo que no
 * es un numero valido, para que la validacion lo rechace con `invalid_price`
 * en vez de ignorarlo en silencio.
 */
const asNonNegativeFinite = (v: unknown): number | undefined => {
  if (v === undefined || v === null || v === "") return undefined;
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : Number.NaN;
};

export const parseWorkshopPriceFields = (
  raw: unknown
): { priceCop?: number; priceUsd?: number } => {
  const body = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return {
    priceCop: asNonNegativeFinite(body.priceCop),
    priceUsd: asNonNegativeFinite(body.priceUsd),
  };
};

/** Matrículas pagadas por edición, en lote — misma definición de "pagada"
 *  que `countPaidForEdition` (lib/crm/workshop-pricing.ts), para no listar
 *  edición por edición desde la página. */
export const countPaidForEditions = async (
  editionIds: string[]
): Promise<Record<string, number>> => {
  if (editionIds.length === 0) return {};
  const rows = await prisma.enrollment.groupBy({
    by: ["workshopEditionId"],
    where: {
      workshopEditionId: { in: editionIds },
      status: { in: [EnrollmentStatus.ACTIVE, EnrollmentStatus.COMPLETED] },
    },
    _count: { _all: true },
  });
  const out: Record<string, number> = {};
  for (const r of rows) {
    if (r.workshopEditionId) out[r.workshopEditionId] = r._count._all;
  }
  return out;
};

/** Una edición con su precio vigente y el título del producto que cobra —
 *  el propio (`taller-<slug>`) o, mientras no tenga precio propio, uno
 *  heredado. Lo que consume el formulario del panel tras crear/guardar. */
export const getWorkshopEditionWithPricing = async (slug: string) => {
  const edition = await prisma.workshopEdition.findUnique({
    where: { slug },
    include: { product: { include: { prices: { orderBy: { validFrom: "desc" } } } } },
  });
  if (!edition) return null;
  const { product, ...rest } = edition;
  return {
    ...rest,
    productTitle: product?.title ?? null,
    prices: latestPricesFromRows(product?.prices ?? []),
  };
};

/** La lista del panel, con precio vigente y matrículas pagadas por edición —
 *  lo que pinta `WorkshopsPageClient`. */
export const listWorkshopEditionsAdminWithPricing = async () => {
  const editions = await prisma.workshopEdition.findMany({
    where: crmEditionWhere,
    orderBy: { createdAt: "desc" },
    include: { product: { include: { prices: { orderBy: { validFrom: "desc" } } } } },
  });
  const paidCounts = await countPaidForEditions(editions.map((e) => e.id));
  return editions.map(({ product, ...rest }) => ({
    ...rest,
    productTitle: product?.title ?? null,
    prices: latestPricesFromRows(product?.prices ?? []),
    paidCount: paidCounts[rest.id] ?? 0,
  }));
};

/**
 * Cambia la URL de una edicion. En una sola transaccion:
 *
 * - comprueba que la nueva URL no la use otra edicion, ni hoy ni antes;
 * - renombra su producto propio `taller-<vieja>` a `taller-<nueva>` (todas las
 *   relaciones con productos son ON UPDATE CASCADE: matriculas, precios,
 *   enlaces de pago y codigos promocionales lo siguen);
 * - guarda la URL vieja para que los enlaces ya enviados redirijan.
 *
 * Lanza `SLUG_TAKEN` si la URL esta ocupada y `WORKSHOP_NOT_FOUND` si la
 * edicion no existe.
 */
export const renameWorkshopSlug = async (oldSlug: string, newSlug: string) => {
  if (oldSlug === newSlug) return;
  try {
    await renameInTransaction(oldSlug, newSlug);
  } catch (e) {
    // Dos cambios a la misma URL a la vez: el índice único decide y el
    // segundo recibe el mismo «ocupada» que si hubiera llegado después.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      throw new Error("SLUG_TAKEN");
    }
    throw e;
  }
};

const renameInTransaction = (oldSlug: string, newSlug: string) =>
  prisma.$transaction(async (tx) => {
    // Un cambio de URL a la vez: `previousSlugs` no tiene índice único, y
    // dos cambios cruzados podían dejar la URL vieja de una edición tapando
    // la actual de otra.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('workshop-slug-rename'))`;

    const edition = await tx.workshopEdition.findUnique({
      where: { slug: oldSlug },
      select: { id: true, productId: true, previousSlugs: true },
    });
    if (!edition) throw new Error("WORKSHOP_NOT_FOUND");

    const clash = await tx.workshopEdition.findFirst({
      where: {
        OR: [{ slug: newSlug }, { previousSlugs: { has: newSlug } }],
        NOT: { id: edition.id },
      },
      select: { id: true },
    });
    if (clash) throw new Error("SLUG_TAKEN");

    // `taller-<nueva>` tiene que estar libre siempre: si quedó uno de un taller
    // borrado (borrar solo lo desactiva), la edición lo adoptaría al ponerle
    // precio, con precios y matrículas ajenas.
    const oldProductId = workshopProductIdFor(oldSlug);
    const newProductId = workshopProductIdFor(newSlug);
    const [oldProduct, productClash] = await Promise.all([
      tx.product.findUnique({ where: { id: oldProductId }, select: { id: true } }),
      tx.product.findUnique({ where: { id: newProductId }, select: { id: true } }),
    ]);
    if (productClash) throw new Error("SLUG_TAKEN");
    if (oldProduct) {
      await tx.product.update({ where: { id: oldProductId }, data: { id: newProductId } });
    }

    await tx.workshopEdition.update({
      where: { id: edition.id },
      data: {
        slug: newSlug,
        previousSlugs: {
          set: [...new Set([...edition.previousSlugs.filter((s) => s !== newSlug), oldSlug])],
        },
      },
    });
  });

/** URL actual de una edicion que antes se llamo `slug`, o `null`. */
export const currentSlugForPrevious = async (slug: string): Promise<string | null> => {
  const edition = await prisma.workshopEdition.findFirst({
    where: { previousSlugs: { has: slug } },
    select: { slug: true },
  });
  return edition?.slug ?? null;
};

/**
 * ¿Pagó esta persona ESTA edición? Más estricto que el acceso a la página:
 * quien compró otro taller con el producto compartido heredado ve la página,
 * pero el enlace de la reunión y el aviso «Ya estás inscrita» son solo para
 * quien pagó esta fecha — matrícula ligada a la edición o a su producto
 * propio. Es la misma regla de los recordatorios.
 */
export const isEnrolledInEdition = async (
  contactId: string,
  slug: string
): Promise<boolean> => {
  const edition = await prisma.workshopEdition.findUnique({
    where: { slug },
    select: { id: true, productId: true },
  });
  if (!edition) return false;
  const ownProductId =
    edition.productId === workshopProductIdFor(slug) ? edition.productId : null;
  const enrollment = await prisma.enrollment.findFirst({
    where: {
      contactId,
      status: { in: [EnrollmentStatus.ACTIVE, EnrollmentStatus.COMPLETED] },
      OR: [
        { workshopEditionId: edition.id },
        ...(ownProductId ? [{ productId: ownProductId }] : []),
      ],
    },
    select: { id: true },
  });
  return enrollment !== null;
};
