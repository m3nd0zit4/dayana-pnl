import { EnrollmentStatus, WorkshopEditionStatus, type WorkshopEdition } from "@prisma/client";
import { prisma } from "@/lib/db";
import { PROXIMO_WORKSHOP_SLUG, isVirtualWorkshopSlug } from "@/lib/workshops";
import {
  recordWorkshopActivitiesTx,
  recordWorkshopActivity,
  type WorkshopActivityInput,
} from "./workshop-activity";
import {
  isWorkshopEnded,
  lifecycleStepFor,
  workshopBlockersMessage,
  workshopCloseAt,
  workshopPublishBlockers,
  workshopStatusAfterReopen,
  workshopStatusAfterUnpublish,
  type WorkshopPublishBlocker,
} from "./workshop-lifecycle-rules";
import { workshopProductIdFor } from "./workshop-price-rows";
import { canOpenWithPrice, deactivateWorkshopProducts } from "./workshop-pricing";

/**
 * El ciclo de una edición de taller, igual que el de un evento gratuito:
 * publicar (cierra las inscripciones del que estuviera publicado), cerrar
 * inscripciones, terminar (a mano o con el reloj), reabrir y borrar. Cada
 * paso queda en su historia y alinea el producto que la cobra: solo se vende
 * mientras está publicada.
 */

export type WorkshopActor = { staffUserId?: string | null };

export class WorkshopLifecycleError extends Error {
  constructor(readonly reason: "not_found" | "ended" | "has_paid_enrollments" | "open" | "virtual_edition") {
    super(reason);
    this.name = "WorkshopLifecycleError";
  }
}

export const WORKSHOP_LIFECYCLE_MESSAGE: Record<WorkshopLifecycleError["reason"], string> = {
  not_found: "No encontré ese taller.",
  ended: "Este taller ya pasó. Reábrelo antes de publicarlo, o duplícalo para una fecha nueva.",
  has_paid_enrollments: "Este taller tiene inscripciones pagadas: no se borra, queda en la historia.",
  open: "Está publicado. Cierra las inscripciones antes de borrarlo.",
  virtual_edition: "Esa edición está reservada.",
};

export class WorkshopPublishError extends Error {
  readonly blockers: WorkshopPublishBlocker[];
  constructor(blockers: WorkshopPublishBlocker[]) {
    super("not_publishable");
    this.name = "WorkshopPublishError";
    this.blockers = blockers;
  }
  get messageEs(): string {
    return workshopBlockersMessage(this.blockers);
  }
}

const load = async (id: string): Promise<WorkshopEdition> => {
  const row = await prisma.workshopEdition.findUnique({ where: { id } });
  if (!row) throw new WorkshopLifecycleError("not_found");
  if (isVirtualWorkshopSlug(row.slug)) throw new WorkshopLifecycleError("virtual_edition");
  return row;
};

/** Lo que le falta para publicarse: título, descripción, fecha y precio en pesos. */
export const getWorkshopPublishBlockers = async (
  row: WorkshopEdition,
  now: Date = new Date()
): Promise<WorkshopPublishBlocker[]> =>
  workshopPublishBlockers(row, await canOpenWithPrice(row.slug, undefined, false), now);

export type WorkshopPublishResult = {
  edition: WorkshopEdition;
  /** Los que estaban publicados y pasaron a «inscripciones cerradas». */
  closed: { id: string; slug: string; title: string }[];
};

/**
 * Publica una edición y cierra las inscripciones de la que estuviera
 * publicada, en una transacción (como `publishFreeEvent`). La cerrada no se
 * cancela: quien ya pagó sigue recibiendo los recordatorios.
 *
 * `enforceBlockers: false` solo para quien ya validó por su cuenta (el
 * asistente, que comprueba el precio antes de escribirlo).
 */
export const publishWorkshopEdition = async (
  id: string,
  actor: WorkshopActor = {},
  opts: { now?: Date; enforceBlockers?: boolean } = {}
): Promise<WorkshopPublishResult> => {
  const now = opts.now ?? new Date();
  const row = await load(id);
  if (isWorkshopEnded(row)) throw new WorkshopLifecycleError("ended");
  if (opts.enforceBlockers !== false) {
    const blockers = await getWorkshopPublishBlockers(row, now);
    if (blockers.length > 0) throw new WorkshopPublishError(blockers);
  }

  const closed = await prisma.$transaction(async (tx) => {
    // Dos publicaciones a la vez podrían dejar dos abiertas.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('workshop-publish'))`;
    const others = await tx.workshopEdition.findMany({
      where: { status: WorkshopEditionStatus.OPEN, id: { not: id }, slug: { not: PROXIMO_WORKSHOP_SLUG } },
      select: { id: true, slug: true, title: true },
    });
    if (others.length > 0) {
      await tx.workshopEdition.updateMany({
        where: { id: { in: others.map((o) => o.id) } },
        data: { status: WorkshopEditionStatus.CLOSED },
      });
      // Cerrada y dejar de cobrarse van juntas.
      await deactivateWorkshopProducts(
        others.map((o) => o.slug),
        tx
      );
    }
    if (row.status !== WorkshopEditionStatus.OPEN) {
      await tx.workshopEdition.update({
        where: { id },
        data: { status: WorkshopEditionStatus.OPEN, publishedAt: row.publishedAt ?? now },
      });
      const activities: WorkshopActivityInput[] = [
        { workshopEditionId: id, kind: "published", at: now, staffUserId: actor.staffUserId },
        ...others.map(
          (o): WorkshopActivityInput => ({
            workshopEditionId: o.id,
            kind: "closed",
            at: now,
            staffUserId: actor.staffUserId,
            meta: { byEditionId: id, byTitle: row.title },
          })
        ),
      ];
      await recordWorkshopActivitiesTx(tx, activities);
    }
    // Publicada = se vende. Solo su producto propio (`taller-<slug>`).
    await tx.product.updateMany({ where: { id: workshopProductIdFor(row.slug) }, data: { isActive: true } });
    return others;
  });

  return { edition: await prisma.workshopEdition.findUniqueOrThrow({ where: { id } }), closed };
};

/**
 * «Cerrar inscripciones»: la publicada pasa a cerrada. Deja de venderse, pero
 * quien ya pagó sigue recibiendo el enlace y los recordatorios.
 */
export const unpublishWorkshopEdition = async (
  id: string,
  actor: WorkshopActor = {}
): Promise<WorkshopEdition> => {
  const row = await load(id);
  const next = workshopStatusAfterUnpublish(row.status);
  if (next !== row.status) {
    await prisma.workshopEdition.update({ where: { id }, data: { status: next } });
    await deactivateWorkshopProducts([row.slug]);
    await recordWorkshopActivity({ workshopEditionId: id, kind: "unpublished", staffUserId: actor.staffUserId });
  }
  return prisma.workshopEdition.findUniqueOrThrow({ where: { id } });
};

/**
 * Da la edición por realizada: corta ventas y recordatorios. Compare-and-swap
 * sobre `endedAt: null`: dos ticks del reloj (o el reloj y Dayana) no la
 * terminan ni la anotan dos veces. Devuelve si la terminó ESTE proceso.
 */
export const endWorkshopEdition = async (
  id: string,
  opts: WorkshopActor & { by: "cron" | "staff"; now?: Date }
): Promise<boolean> => {
  const now = opts.now ?? new Date();
  const { count } = await prisma.workshopEdition.updateMany({
    where: { id, endedAt: null, slug: { not: PROXIMO_WORKSHOP_SLUG } },
    data: { endedAt: now, status: WorkshopEditionStatus.COMPLETED },
  });
  const row = await prisma.workshopEdition.findUnique({ where: { id }, select: { slug: true, status: true, endedAt: true } });
  if (!row) throw new WorkshopLifecycleError("not_found");
  if (count === 0) {
    // Terminada de antes sin estado (a mano en la base): se pone al día sin anotar.
    if (row.endedAt && row.status !== WorkshopEditionStatus.COMPLETED) {
      await prisma.workshopEdition.update({ where: { id }, data: { status: WorkshopEditionStatus.COMPLETED } });
    }
    return false;
  }
  await deactivateWorkshopProducts([row.slug]);
  await recordWorkshopActivity({
    workshopEditionId: id,
    kind: "ended",
    at: now,
    staffUserId: opts.staffUserId,
    meta: { by: opts.by },
  });
  return true;
};

/** Reabrir una terminada por error: queda cerrada (sin ventas) hasta publicarla. */
export const reopenWorkshopEdition = async (
  id: string,
  actor: WorkshopActor = {}
): Promise<WorkshopEdition> => {
  const row = await load(id);
  if (isWorkshopEnded(row)) {
    await prisma.workshopEdition.update({
      where: { id },
      data: { endedAt: null, status: workshopStatusAfterReopen(row.status) },
    });
    await recordWorkshopActivity({ workshopEditionId: id, kind: "reopened", staffUserId: actor.staffUserId });
  }
  return prisma.workshopEdition.findUniqueOrThrow({ where: { id } });
};

/**
 * Quién pagó, también por el producto (propio o heredado) antes de que las
 * matrículas se ligaran a la edición. Con alguien así no se borra: se cierra.
 */
export const countPaidForEditionDelete = async (
  row: Pick<WorkshopEdition, "id" | "productId" | "legacyProductId">
): Promise<number> => {
  const productIds = [row.productId, row.legacyProductId].filter((p): p is string => Boolean(p));
  return prisma.enrollment.count({
    where: {
      status: { in: [EnrollmentStatus.ACTIVE, EnrollmentStatus.COMPLETED] },
      OR: [{ workshopEditionId: row.id }, ...(productIds.length > 0 ? [{ productId: { in: productIds } }] : [])],
    },
  });
};

/** Borra una edición sin pagos y sin publicar. Devuelve sus documentos para borrarlos del almacenamiento. */
export const deleteWorkshopEdition = async (id: string): Promise<{ slug: string; documentUrls: string[] }> => {
  const row = await load(id);
  if (row.status === WorkshopEditionStatus.OPEN) throw new WorkshopLifecycleError("open");
  if ((await countPaidForEditionDelete(row)) > 0) throw new WorkshopLifecycleError("has_paid_enrollments");
  const docs = await prisma.workshopDocument.findMany({ where: { workshopEditionId: id }, select: { url: true } });
  await deactivateWorkshopProducts([row.slug]);
  await prisma.workshopEdition.delete({ where: { id } });
  return { slug: row.slug, documentUrls: docs.map((d) => d.url) };
};

/* -------------------------------------------------------------------------
 * El reloj
 * ---------------------------------------------------------------------- */

/** Las ediciones en pie (publicada o con inscripciones cerradas, sin terminar). */
export const listLiveWorkshopEditions = () =>
  prisma.workshopEdition.findMany({
    where: {
      endedAt: null,
      status: { in: [WorkshopEditionStatus.OPEN, WorkshopEditionStatus.CLOSED] },
      slug: { not: PROXIMO_WORKSHOP_SLUG },
    },
    orderBy: [{ startsAt: { sort: "asc", nulls: "last" } }],
  });

/**
 * Termina las que ya pasaron. Devuelve las que terminó ESTE proceso.
 *
 * Una que Dayana reabrió a mano después de su hora de cierre no se vuelve a
 * terminar sola: la reabrió para algo (cambiarle la fecha). Publicarla pide
 * antes una fecha que no haya pasado; con la fecha nueva el reloj vuelve a
 * mandar.
 */
export const closeDueWorkshops = async (now: Date = new Date()): Promise<WorkshopEdition[]> => {
  const live = await listLiveWorkshopEditions();
  const closed: WorkshopEdition[] = [];
  for (const e of live) {
    const closeAt = workshopCloseAt(e);
    if (!closeAt || now < closeAt) continue;
    const reopened = await prisma.workshopEditionActivity.findFirst({
      where: { workshopEditionId: e.id, kind: "reopened", at: { gte: closeAt } },
      select: { id: true },
    });
    if (reopened) continue;
    if (await endWorkshopEdition(e.id, { by: "cron", now })) {
      closed.push(await prisma.workshopEdition.findUniqueOrThrow({ where: { id: e.id } }));
    }
  }
  return closed;
};

/* -------------------------------------------------------------------------
 * Compatibilidad
 * ---------------------------------------------------------------------- */

/**
 * «Déjala en este estado», para quien todavía escribe estados (el asistente).
 * Pasa por los mismos pasos que los botones del panel, sin exigir lo que pide
 * publicar desde el panel: quien llama ya comprobó el precio.
 */
export const applyWorkshopStatus = async (
  id: string,
  target: WorkshopEditionStatus,
  actor: WorkshopActor = {}
): Promise<void> => {
  const row = await load(id);
  const step = lifecycleStepFor(row, target);
  switch (step) {
    case null:
      return;
    case "publish":
      await publishWorkshopEdition(id, actor, { enforceBlockers: false });
      return;
    case "reopen_publish":
      await reopenWorkshopEdition(id, actor);
      await publishWorkshopEdition(id, actor, { enforceBlockers: false });
      return;
    case "unpublish":
      await unpublishWorkshopEdition(id, actor);
      return;
    case "reopen":
      await reopenWorkshopEdition(id, actor);
      return;
    case "close_draft":
      await prisma.workshopEdition.update({
        where: { id },
        data: { status: WorkshopEditionStatus.CLOSED, publishedAt: row.publishedAt ?? new Date() },
      });
      return;
    case "end":
      await endWorkshopEdition(id, { by: "staff", staffUserId: actor.staffUserId });
      return;
    case "to_draft":
      await prisma.workshopEdition.update({
        where: { id },
        data: { status: WorkshopEditionStatus.DRAFT, endedAt: null },
      });
      await deactivateWorkshopProducts([row.slug]);
      await recordWorkshopActivity({ workshopEditionId: id, kind: "back_to_draft", staffUserId: actor.staffUserId });
      return;
  }
};
