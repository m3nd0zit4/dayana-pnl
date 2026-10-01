import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

/**
 * La historia de un evento gratuito (`free_event_activities`): qué pasó y
 * cuándo. Solo se añade. Registrar nunca rompe lo que se está haciendo: un
 * envío que salió no puede fallar porque no se pudo anotar.
 */

export type FreeEventActivityKind =
  | "created"
  | "published"
  | "unpublished"
  | "closed"
  | "ended"
  | "reopened"
  | "meet_link_set"
  | "meet_link_changed"
  | "date_changed"
  | "link_emails"
  | "reminder_24h_email"
  | "reminder_1h_email"
  | "reminder_24h_wa"
  | "reminder_1h_wa"
  | "material_uploaded"
  | "material_sent"
  | "whatsapp_bulk";

export type FreeEventActivityInput = {
  freeWebinarId: string;
  kind: FreeEventActivityKind;
  at?: Date;
  count?: number | null;
  failed?: number | null;
  staffUserId?: string | null;
  whatsAppSendId?: string | null;
  meta?: Record<string, unknown> | null;
};

const toData = (input: FreeEventActivityInput): Prisma.FreeEventActivityCreateManyInput => ({
  freeWebinarId: input.freeWebinarId,
  kind: input.kind,
  ...(input.at ? { at: input.at } : {}),
  count: input.count ?? null,
  failed: input.failed ?? null,
  staffUserId: input.staffUserId ?? null,
  whatsAppSendId: input.whatsAppSendId ?? null,
  meta: input.meta ? (input.meta as Prisma.InputJsonValue) : Prisma.DbNull,
});

export const recordFreeEventActivity = async (input: FreeEventActivityInput): Promise<void> => {
  await prisma.freeEventActivity
    .create({ data: toData(input) })
    .catch((e: unknown) => console.error("[eventos] historia", input.kind, e));
};

/** Dentro de una transacción: aquí sí falla con ella, porque es parte del cambio. */
export const recordFreeEventActivitiesTx = async (
  tx: Pick<typeof prisma, "freeEventActivity">,
  inputs: FreeEventActivityInput[]
): Promise<void> => {
  if (inputs.length === 0) return;
  await tx.freeEventActivity.createMany({ data: inputs.map(toData) });
};

export const listFreeEventActivities = (freeWebinarId: string) =>
  prisma.freeEventActivity.findMany({
    where: { freeWebinarId },
    orderBy: { at: "asc" },
    take: 2000,
  });
