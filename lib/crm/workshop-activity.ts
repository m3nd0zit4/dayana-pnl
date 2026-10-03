import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

/**
 * La historia de una edición de taller (`workshop_edition_activities`), como
 * la de los eventos. Solo se añade, y anotar nunca rompe lo que se está
 * haciendo: un recordatorio que salió no puede fallar porque no se anotó.
 */

export type WorkshopActivityKind =
  | "created"
  | "published"
  | "unpublished"
  | "closed"
  | "ended"
  | "reopened"
  | "back_to_draft"
  | "date_changed"
  | "meeting_link_set"
  | "meeting_link_changed"
  | "price_changed"
  | "reminder_24h_email"
  | "reminder_1h_email"
  | "reminder_24h_wa"
  | "reminder_1h_wa"
  | "whatsapp_bulk";

export type WorkshopActivityInput = {
  workshopEditionId: string;
  kind: WorkshopActivityKind;
  at?: Date;
  count?: number | null;
  failed?: number | null;
  staffUserId?: string | null;
  whatsAppSendId?: string | null;
  meta?: Record<string, unknown> | null;
};

const toData = (input: WorkshopActivityInput): Prisma.WorkshopEditionActivityCreateManyInput => ({
  workshopEditionId: input.workshopEditionId,
  kind: input.kind,
  ...(input.at ? { at: input.at } : {}),
  count: input.count ?? null,
  failed: input.failed ?? null,
  staffUserId: input.staffUserId ?? null,
  whatsAppSendId: input.whatsAppSendId ?? null,
  meta: input.meta ? (input.meta as Prisma.InputJsonValue) : Prisma.DbNull,
});

export const recordWorkshopActivity = async (input: WorkshopActivityInput): Promise<void> => {
  await prisma.workshopEditionActivity
    .create({ data: toData(input) })
    .catch((e: unknown) => console.error("[talleres] historia", input.kind, e));
};

/** Dentro de una transacción: aquí sí falla con ella, porque es parte del cambio. */
export const recordWorkshopActivitiesTx = async (
  tx: Pick<typeof prisma, "workshopEditionActivity">,
  inputs: WorkshopActivityInput[]
): Promise<void> => {
  if (inputs.length === 0) return;
  await tx.workshopEditionActivity.createMany({ data: inputs.map(toData) });
};

export const listWorkshopActivities = (workshopEditionId: string) =>
  prisma.workshopEditionActivity.findMany({
    where: { workshopEditionId },
    orderBy: { at: "asc" },
    take: 2000,
  });
