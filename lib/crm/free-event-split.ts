import { Prisma, type FreeWebinar, type WebinarRegistration } from "@prisma/client";
import { prisma } from "@/lib/db";
import { FREE_WEBINAR_SLUG, resolveWebinarCloseAt } from "./free-webinar";
import { getOperationalTimezone } from "./operational-timezone";

/**
 * Separa una edición pasada que se quedó mezclada en la fila viva.
 *
 * Pasó así: el evento de agosto nunca se archivó; Dayana le cambió la fecha a
 * la fila `gratuito` y las inscripciones de agosto y las de octubre quedaron
 * colgando de la misma edición. Quien se inscribió a las dos tiene UNA fila
 * (`recordWebinarRegistration` hace upsert con `update: {}`), fechada en agosto.
 *
 * Qué hace, todo en una sola transacción:
 * 1. Crea la edición pasada (archivada, terminada) copiando el contenido de la
 *    viva, con su fecha y su enlace de Meet.
 * 2. Pasa a ella las inscripciones de antes del corte, con todos los sellos
 *    (correo y WhatsApp) puestos: de esa edición ya no sale nada.
 * 3. A quien se volvió a inscribir le deja una copia en la pasada y en la viva
 *    le pone la fecha de su nueva inscripción (y le quita los sellos de antes
 *    del corte, que eran de agosto).
 *
 * Idempotente: una segunda pasada no encuentra nada que mover. Sin `apply`
 * solo devuelve el plan.
 */

export type SplitParams = {
  pastStartsAt: Date;
  pastStartsAtHasTime?: boolean;
  pastMeetUrl: string;
  /** Lo creado antes de este instante es de la edición pasada. */
  cutoff: Date;
  /** Sin lista, se deducen de los avisos `WEB_LEAD_SUBMITTED` de webinar. */
  reRegistrants?: { contactId: string; at?: Date | null }[];
  /**
   * Solo para las pruebas, que no pueden tocar la fila viva compartida. El
   * script no lo expone: allí siempre es «gratuito».
   */
  liveSlug?: string;
};

const slugOf = (params: Pick<SplitParams, "liveSlug">) => params.liveSlug ?? FREE_WEBINAR_SLUG;

const STAMPS = [
  "linkEmailSentAt",
  "reminder24hSentAt",
  "reminder1hSentAt",
  "reminder24hWaSentAt",
  "reminder1hWaSentAt",
] as const;

export type SplitReRegistrant = {
  registrationId: string;
  contactId: string;
  name: string;
  phone: string;
  /** Su inscripción original (agosto): la fecha de la copia en la pasada. */
  registeredAt: Date;
  /** Cuándo se volvió a inscribir: la nueva fecha en la viva. */
  reRegisteredAt: Date;
  alreadyOnPast: boolean;
};

export type SplitPlan = {
  params: SplitParams;
  live: { id: string; slug: string; headline: string; startsAt: Date | null; total: number };
  past: { id: string | null; exists: boolean; startsAt: Date; startsAtHasTime: boolean; meetUrl: string };
  /** Inscripciones de antes del corte que pasan a la edición pasada. */
  toMove: { id: string; contactId: string; createdAt: Date }[];
  reRegistrants: SplitReRegistrant[];
  /** Sellos de antes del corte en las filas vivas de quienes repiten. */
  staleLiveStamps: number;
  /** Las que quedan en la viva después. */
  stayOnLive: number;
  /** Copia de todas las filas que se tocan, tal como están. */
  backupRows: WebinarRegistration[];
  liveRow: FreeWebinar;
};

export type SplitApplied = {
  pastId: string;
  createdPast: boolean;
  moved: number;
  copied: number;
  copyIds: string[];
  liveRedated: number;
  stampsCleared: number;
};

export class FreeEventSplitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FreeEventSplitError";
  }
}

/** La edición pasada: archivada (`gratuito-…`) con esa misma fecha. */
const pastQuery = (liveSlug: string, startsAt: Date) =>
  ({
    where: { slug: { startsWith: `${liveSlug}-` }, startsAt },
    orderBy: { createdAt: "asc" },
  }) satisfies Prisma.FreeWebinarFindFirstArgs;

/** Primera vez que volvió a inscribirse después del corte, por contacto. */
const reRegistrationsSince = async (cutoff: Date, contactIds: string[]): Promise<Map<string, Date>> => {
  if (contactIds.length === 0) return new Map();
  const notes = await prisma.platformNotification.findMany({
    where: {
      eventType: "WEB_LEAD_SUBMITTED",
      entityType: "Contact",
      entityId: { in: contactIds },
      createdAt: { gte: cutoff },
      OR: [
        { metadata: { path: ["webinar"], equals: true } },
        { metadata: { path: ["webinar"], equals: "true" } },
      ],
    },
    orderBy: { createdAt: "asc" },
    select: { entityId: true, createdAt: true },
  });
  const first = new Map<string, Date>();
  for (const n of notes) if (n.entityId && !first.has(n.entityId)) first.set(n.entityId, n.createdAt);
  return first;
};

export const planFreeEventSplit = async (params: SplitParams): Promise<SplitPlan> => {
  const slug = slugOf(params);
  const liveRow = await prisma.freeWebinar.findUnique({ where: { slug } });
  if (!liveRow) throw new FreeEventSplitError(`No hay edición viva («${slug}»).`);
  if (!(params.cutoff.getTime() > params.pastStartsAt.getTime())) {
    throw new FreeEventSplitError("El corte tiene que ser posterior a la fecha de la edición pasada.");
  }

  const [past, total, before] = await Promise.all([
    prisma.freeWebinar.findFirst(pastQuery(slug, params.pastStartsAt)),
    prisma.webinarRegistration.count({ where: { webinarId: liveRow.id } }),
    prisma.webinarRegistration.findMany({
      where: { webinarId: liveRow.id, createdAt: { lt: params.cutoff } },
      orderBy: { createdAt: "asc" },
      include: { contact: { select: { firstName: true, lastName: true, phoneE164: true } } },
    }),
  ]);
  const onPast = past
    ? new Set(
        (
          await prisma.webinarRegistration.findMany({
            where: { webinarId: past.id },
            select: { contactId: true },
          })
        ).map((r) => r.contactId)
      )
    : new Set<string>();

  const contactIds = before.map((r) => r.contactId);
  const given = params.reRegistrants ? new Map(params.reRegistrants.map((r) => [r.contactId, r.at ?? null])) : null;
  const seen = await reRegistrationsSince(params.cutoff, given ? [...given.keys()] : contactIds);

  const reRegistrants: SplitReRegistrant[] = [];
  const toMove: SplitPlan["toMove"] = [];
  let staleLiveStamps = 0;
  for (const r of before) {
    const isRe = given ? given.has(r.contactId) : seen.has(r.contactId);
    if (!isRe) {
      // Si la persona ya está en la pasada no se puede mover (índice único):
      // se queda, y el plan lo deja a la vista como «stayOnLive».
      if (!onPast.has(r.contactId)) toMove.push({ id: r.id, contactId: r.contactId, createdAt: r.createdAt });
      continue;
    }
    const at = given?.get(r.contactId) ?? seen.get(r.contactId) ?? params.cutoff;
    // Nunca antes del corte: si no, la siguiente pasada la volvería a tomar.
    const reRegisteredAt = at.getTime() < params.cutoff.getTime() ? params.cutoff : at;
    reRegistrants.push({
      registrationId: r.id,
      contactId: r.contactId,
      name: [r.contact.firstName, r.contact.lastName].filter(Boolean).join(" "),
      phone: r.contact.phoneE164,
      registeredAt: r.createdAt,
      reRegisteredAt,
      alreadyOnPast: onPast.has(r.contactId),
    });
    for (const s of STAMPS) {
      const v = r[s];
      if (v && v.getTime() < params.cutoff.getTime()) staleLiveStamps += 1;
    }
  }

  const touched = new Set([...toMove.map((r) => r.id), ...reRegistrants.map((r) => r.registrationId)]);
  return {
    params,
    live: { id: liveRow.id, slug: liveRow.slug, headline: liveRow.headline, startsAt: liveRow.startsAt, total },
    past: {
      id: past?.id ?? null,
      exists: Boolean(past),
      startsAt: params.pastStartsAt,
      startsAtHasTime: params.pastStartsAtHasTime ?? true,
      meetUrl: params.pastMeetUrl,
    },
    toMove,
    reRegistrants,
    staleLiveStamps,
    stayOnLive: total - toMove.length,
    // Sin el contacto: la copia es de la tabla tal cual, para restaurarla.
    backupRows: before
      .filter((r) => touched.has(r.id))
      .map((r) => {
        const row: Partial<typeof r> = { ...r };
        delete row.contact;
        return row as WebinarRegistration;
      }),
    liveRow,
  };
};

/** Escribe el plan. Una sola transacción: o entra todo o no entra nada. */
export const applyFreeEventSplit = async (plan: SplitPlan): Promise<SplitApplied> => {
  const { params } = plan;
  const slug = slugOf(params);
  const tz = await getOperationalTimezone();
  const hasTime = params.pastStartsAtHasTime ?? true;
  const endedAt =
    resolveWebinarCloseAt({ startsAt: params.pastStartsAt, startsAtHasTime: hasTime }, tz) ?? params.pastStartsAt;

  return prisma.$transaction(
    async (tx) => {
      const live = await tx.freeWebinar.findUnique({ where: { slug } });
      if (!live || live.id !== plan.live.id) {
        throw new FreeEventSplitError("La edición viva cambió desde el plan: vuelve a generarlo.");
      }

      let past = await tx.freeWebinar.findFirst(pastQuery(slug, params.pastStartsAt));
      const createdPast = !past;
      if (!past) {
        const l = live;
        const created = await tx.freeWebinar.create({
          data: {
            // Temporal: el slug definitivo lleva el id, que aún no existe.
            slug: `${slug}-split-${Date.now()}`,
            isActive: false,
            status: "COMPLETED",
            headline: l.headline,
            subheadline: l.subheadline,
            body: l.body,
            startsAt: params.pastStartsAt,
            startsAtHasTime: hasTime,
            meetUrl: params.pastMeetUrl,
            videoUrl: l.videoUrl,
            // Los ids de Mux casan webhooks con updateMany: nunca en dos filas.
            muxUploadId: null,
            muxAssetId: null,
            muxPlaybackId: l.muxPlaybackId,
            videoStatus: l.videoStatus,
            videoDurationSec: l.videoDurationSec,
            videoErrorMessage: l.videoErrorMessage,
            learnSectionTitle: l.learnSectionTitle,
            learnItems: l.learnItems as Prisma.InputJsonValue,
            faq: l.faq === null ? Prisma.DbNull : (l.faq as Prisma.InputJsonValue),
            ctaLabel: l.ctaLabel,
            formTitle: l.formTitle,
            metaTitle: l.metaTitle,
            metaDescription: l.metaDescription,
            eventLabel: l.eventLabel,
            locationLabel: l.locationLabel,
            priceLabel: l.priceLabel,
            faqTitle: l.faqTitle,
            materialLabel: l.materialLabel,
            successMessage: l.successMessage,
            linkEnabled: l.linkEnabled,
            linkTitle: l.linkTitle,
            linkSubtitle: l.linkSubtitle,
            capacity: l.capacity,
            materialUrl: l.materialUrl,
            materialFileName: l.materialFileName,
            materialMimeType: l.materialMimeType,
            materialSizeBytes: l.materialSizeBytes,
            endedAt,
            archivedAt: new Date(),
          },
        });
        past = await tx.freeWebinar.update({
          where: { id: created.id },
          data: { slug: `${slug}-${created.id}` },
        });
      }
      const pastId = past.id;
      const sealedAt = params.pastStartsAt;

      // 2. Mover. Primero los sellos (COALESCE: el que ya tenía fecha la
      // conserva), luego la fila. La guarda `webinarId + createdAt < corte`
      // hace que repetir no toque nada.
      const onPast = new Set(
        (await tx.webinarRegistration.findMany({ where: { webinarId: pastId }, select: { contactId: true } })).map(
          (r) => r.contactId
        )
      );
      const moveIds = plan.toMove.filter((r) => !onPast.has(r.contactId)).map((r) => r.id);
      const movable = { id: { in: moveIds }, webinarId: live.id, createdAt: { lt: params.cutoff } };
      for (const s of STAMPS) {
        await tx.webinarRegistration.updateMany({ where: { ...movable, [s]: null }, data: { [s]: sealedAt } });
      }
      const moved = moveIds.length
        ? (await tx.webinarRegistration.updateMany({ where: movable, data: { webinarId: pastId } })).count
        : 0;

      // 3. Quienes repiten: copia en la pasada con todo sellado…
      const pending = plan.reRegistrants.filter((r) => !onPast.has(r.contactId));
      const copied = pending.length
        ? (
            await tx.webinarRegistration.createMany({
              data: pending.map((r) => ({
                webinarId: pastId,
                contactId: r.contactId,
                createdAt: r.registeredAt,
                ...Object.fromEntries(STAMPS.map((s) => [s, sealedAt])),
              })),
              skipDuplicates: true,
            })
          ).count
        : 0;
      const copyIds = (
        await tx.webinarRegistration.findMany({
          where: { webinarId: pastId, contactId: { in: pending.map((r) => r.contactId) } },
          select: { id: true },
        })
      ).map((r) => r.id);

      // …y en la viva, sin los sellos de agosto y con su fecha nueva.
      const reIds = plan.reRegistrants.map((r) => r.registrationId);
      let stampsCleared = 0;
      for (const s of STAMPS) {
        stampsCleared += (
          await tx.webinarRegistration.updateMany({
            where: { id: { in: reIds }, webinarId: live.id, [s]: { lt: params.cutoff } },
            data: { [s]: null },
          })
        ).count;
      }
      let liveRedated = 0;
      for (const r of plan.reRegistrants) {
        liveRedated += (
          await tx.webinarRegistration.updateMany({
            where: { id: r.registrationId, webinarId: live.id, createdAt: { lt: params.cutoff } },
            data: { createdAt: r.reRegisteredAt },
          })
        ).count;
      }

      return { pastId, createdPast, moved, copied, copyIds, liveRedated, stampsCleared };
    },
    { maxWait: 15_000, timeout: 120_000 }
  );
};

/** Plan y, si `apply`, escritura. Sin `apply` no toca la base de datos. */
export const freeEventSplit = async (
  params: SplitParams & { apply?: boolean }
): Promise<{ plan: SplitPlan; applied: SplitApplied | null }> => {
  const plan = await planFreeEventSplit(params);
  if (!params.apply) return { plan, applied: null };
  return { plan, applied: await applyFreeEventSplit(plan) };
};

/* ------------------------------------------------------------------------
 * Copia de seguridad y vuelta atrás
 * --------------------------------------------------------------------- */

export type SplitBackup = {
  version: 1;
  writtenAt: string;
  params: { pastStartsAt: string; pastStartsAtHasTime: boolean; pastMeetUrl: string; cutoff: string };
  live: FreeWebinar;
  pastExisted: boolean;
  reRegistrantContactIds: string[];
  rows: WebinarRegistration[];
  applied?: SplitApplied;
};

export const splitBackupOf = (plan: SplitPlan, applied?: SplitApplied): SplitBackup => ({
  version: 1,
  writtenAt: new Date().toISOString(),
  params: {
    pastStartsAt: plan.params.pastStartsAt.toISOString(),
    pastStartsAtHasTime: plan.params.pastStartsAtHasTime ?? true,
    pastMeetUrl: plan.params.pastMeetUrl,
    cutoff: plan.params.cutoff.toISOString(),
  },
  live: plan.liveRow,
  pastExisted: plan.past.exists,
  reRegistrantContactIds: plan.reRegistrants.map((r) => r.contactId),
  rows: plan.backupRows,
  ...(applied ? { applied } : {}),
});

const asDate = (v: unknown): Date | null => (v == null ? null : new Date(v as string));

/**
 * Deja las filas como estaban en la copia, borra las copias en la pasada y,
 * si la creó el split y queda vacía, la edición pasada.
 */
export const rollbackFreeEventSplit = async (
  backup: SplitBackup
): Promise<{ restored: number; copiesDeleted: number; pastDeleted: boolean }> => {
  if (backup.version !== 1) throw new FreeEventSplitError("Copia de seguridad de otra versión.");
  const pastStartsAt = new Date(backup.params.pastStartsAt);

  return prisma.$transaction(
    async (tx) => {
      const past = backup.applied
        ? await tx.freeWebinar.findUnique({ where: { id: backup.applied.pastId } })
        : await tx.freeWebinar.findFirst(pastQuery(backup.live.slug, pastStartsAt));
      const createdPast = backup.applied ? backup.applied.createdPast : !backup.pastExisted;

      let restored = 0;
      for (const row of backup.rows) {
        restored += (
          await tx.webinarRegistration.updateMany({
            where: { id: row.id },
            data: {
              webinarId: row.webinarId,
              createdAt: new Date(row.createdAt),
              linkEmailSentAt: asDate(row.linkEmailSentAt),
              reminder24hSentAt: asDate(row.reminder24hSentAt),
              reminder1hSentAt: asDate(row.reminder1hSentAt),
              reminder24hWaSentAt: asDate(row.reminder24hWaSentAt),
              reminder1hWaSentAt: asDate(row.reminder1hWaSentAt),
              waReminderError: row.waReminderError ?? null,
              waReminderErrorAt: asDate(row.waReminderErrorAt),
              lastSendError: row.lastSendError ?? null,
              lastSendErrorAt: asDate(row.lastSendErrorAt),
            },
          })
        ).count;
      }

      let copiesDeleted = 0;
      if (past) {
        const copyIds =
          backup.applied?.copyIds ??
          (
            await tx.webinarRegistration.findMany({
              where: { webinarId: past.id, contactId: { in: backup.reRegistrantContactIds } },
              select: { id: true },
            })
          ).map((r) => r.id);
        copiesDeleted = (await tx.webinarRegistration.deleteMany({ where: { id: { in: copyIds }, webinarId: past.id } }))
          .count;
      }

      let pastDeleted = false;
      if (past && createdPast) {
        const left = await tx.webinarRegistration.count({ where: { webinarId: past.id } });
        if (left > 0) {
          throw new FreeEventSplitError(
            `La edición pasada todavía tiene ${left} inscripciones que no son de la copia: no se borra.`
          );
        }
        await tx.freeWebinar.delete({ where: { id: past.id } });
        pastDeleted = true;
      }
      return { restored, copiesDeleted, pastDeleted };
    },
    { maxWait: 15_000, timeout: 120_000 }
  );
};
