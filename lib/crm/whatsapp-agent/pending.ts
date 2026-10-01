import type { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";
import { contactPhoneCandidates, whatsAppDigits } from "@/lib/whatsapp-contact";
import type { ResolveReason } from "../whatsapp-pending-rules";

/**
 * «Pendiente» en la base: la consulta de la cola y las dos escrituras
 * (resolver y reabrir). Las reglas puras viven en `../whatsapp-pending-rules`.
 *
 * Importes estáticos a propósito: esto lo usan `approvals.ts`,
 * `appointments.ts` y `workspace.ts`, que se empaquetan también para el agente
 * (eve no admite un `import()` dinámico nuevo en ese árbol).
 */

/** Chats donde la persona escribió después de la última resolución (o nunca se resolvió). */
export const pendingWhere = (): Prisma.ConversationWhereInput => ({
  AND: [
    { lastInboundAt: { not: null } },
    {
      OR: [{ resolvedAt: null }, { lastInboundAt: { gt: prisma.conversation.fields.resolvedAt } }],
    },
  ],
});

const clean = (values: (string | null | undefined)[] | undefined): string[] =>
  [...new Set((values ?? []).map((v) => v?.trim() ?? "").filter(Boolean))];

/** Todas las formas en que puede estar guardado el hilo de un número (521…/52…, 549…/54…). */
const threadIdsFor = (phones: string[]): string[] => {
  const out = new Set<string>();
  for (const phone of phones) {
    const d = phone.replace(/\D/g, "");
    if (d.length < 8) continue;
    out.add(d);
    out.add(whatsAppDigits(`+${d}`));
    for (const p of contactPhoneCandidates(d)) out.add(p.replace(/\D/g, ""));
  }
  return [...out];
};

export type ResolveTarget = {
  ids?: (string | null | undefined)[];
  /** Número en dígitos o E.164 (el de la cita, el del chat…). */
  phones?: (string | null | undefined)[];
  contactIds?: (string | null | undefined)[];
};

/**
 * Da por atendidos los chats indicados, solo si están pendientes (un chat ya
 * resuelto conserva su motivo). `seenInboundAt`: el último mensaje que Dayana
 * tenía a la vista; si llegó uno más nuevo, no se resuelve (no se traga un
 * mensaje que nadie leyó). Devuelve los ids resueltos.
 */
export const resolveConversations = async (
  target: ResolveTarget,
  reason: ResolveReason,
  staffId?: string | null,
  opts: { seenInboundAt?: Date | null } = {}
): Promise<string[]> => {
  const ids = clean(target.ids);
  const threads = threadIdsFor(clean(target.phones));
  const contactIds = clean(target.contactIds);
  const or: Prisma.ConversationWhereInput[] = [];
  if (ids.length) or.push({ id: { in: ids } });
  if (threads.length) or.push({ externalThreadId: { in: threads } });
  if (contactIds.length) or.push({ contactId: { in: contactIds } });
  if (or.length === 0) return [];

  const where: Prisma.ConversationWhereInput = {
    channel: "WHATSAPP",
    AND: [
      { OR: or },
      pendingWhere(),
      ...(opts.seenInboundAt ? [{ lastInboundAt: { lte: opts.seenInboundAt } }] : []),
    ],
  };
  const rows = await prisma.conversation.findMany({ where, select: { id: true } });
  if (rows.length === 0) return [];
  const found = rows.map((r) => r.id);
  await prisma.conversation.updateMany({
    // Se repite la condición: entre leer y escribir otro proceso pudo
    // resolverlo (se queda su motivo) o pudo entrar un mensaje más nuevo.
    where: { AND: [{ id: { in: found } }, where] },
    data: { resolvedAt: new Date(), resolvedReason: reason, resolvedById: staffId ?? null },
  });
  return found;
};

/** «Volver a pendiente». Solo tiene sentido si la persona escribió alguna vez. */
export const reopenConversation = async (id: string): Promise<boolean> => {
  const { count } = await prisma.conversation.updateMany({
    where: { id, lastInboundAt: { not: null } },
    data: { resolvedAt: null, resolvedReason: null, resolvedById: null },
  });
  return count > 0;
};
