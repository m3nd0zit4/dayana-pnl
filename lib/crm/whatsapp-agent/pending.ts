import type { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";
import { contactPhoneCandidates, whatsAppDigits } from "@/lib/whatsapp-contact";
import { isPending, type ResolveReason } from "../whatsapp-attention-rules";
import { closeAttention, type CloseBy } from "./attention";

/**
 * Cerrar chats por algo que pasó fuera de ellos: una cita agendada o
 * confirmada, un pago confirmado. Sale de «Te toca» (`./attention`) y queda
 * anotado por qué (`resolvedReason`: «Seguimiento» no muestra a quien ya
 * agendó o pagó). «Listo» vive en `./attention` (`markAttended`).
 *
 * Importes estáticos a propósito: esto lo usan `approvals.ts` y
 * `appointments.ts`, que se empaquetan también para el agente (eve no admite
 * un `import()` dinámico nuevo en ese árbol).
 */

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

const CLOSE_BY: Record<ResolveReason, CloseBy> = {
  appointment: "appointment",
  payment: "payment",
  manual: "listo",
  import: "listo",
  backfill: "listo",
};

/**
 * Cierra los chats indicados por una cita o un pago. `seenInboundAt`: hasta
 * qué mensaje de la persona cubre (la cita se creó, la IA leyó…); lo que
 * escribió después sigue tocando. Un chat ya resuelto conserva su motivo.
 * Devuelve los ids que cambiaron.
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

  const upTo = opts.seenInboundAt ?? new Date();
  const rows = await prisma.conversation.findMany({
    where: { channel: "WHATSAPP", OR: or },
    select: { id: true, lastInboundAt: true, resolvedAt: true },
  });
  const changed: string[] = [];
  for (const r of rows) {
    const closed = await closeAttention(r.id, { by: CLOSE_BY[reason], upTo });
    let resolved = false;
    if (isPending(r) && r.lastInboundAt && r.lastInboundAt.getTime() <= upTo.getTime()) {
      const { count } = await prisma.conversation.updateMany({
        // Se repite la condición: entre leer y escribir pudo entrar otro mensaje.
        where: { id: r.id, lastInboundAt: { lte: upTo }, OR: [{ resolvedAt: null }, { resolvedAt: r.resolvedAt }] },
        data: { resolvedAt: new Date(), resolvedReason: reason, resolvedById: staffId ?? null },
      });
      resolved = count > 0;
    }
    if (closed || resolved) changed.push(r.id);
  }
  return changed;
};
