import { isWhatsAppUserId, whatsAppDigits, whatsAppIdVariants } from "@/lib/whatsapp-contact";

/**
 * Chats duplicados de una misma persona (el mismo número guardado en dos
 * formas: México 52/521, Argentina 54/549, Brasil con y sin 9). Puro: lo usa
 * `scripts/whatsapp-merge-threads.ts` y las pruebas.
 *
 * Queda el chat con más mensajes (a igualdad, el que tiene la forma con la que
 * WhatsApp manda, y si no el más reciente); los demás se le pasan.
 */

export type ThreadRow = {
  id: string;
  externalThreadId: string;
  messages: number;
  lastMessageAt: Date | null;
};

export type MergePlan = {
  survivorId: string;
  survivorThreadId: string;
  merge: { id: string; externalThreadId: string; messages: number }[];
};

/** Clave de la persona: la menor de las formas de su número. */
const personKey = (threadId: string): string => {
  const variants = whatsAppIdVariants(threadId);
  return [...variants].sort()[0] ?? threadId;
};

export const planThreadMerges = (rows: ThreadRow[]): MergePlan[] => {
  const groups = new Map<string, ThreadRow[]>();
  for (const r of rows) {
    if (isWhatsAppUserId(r.externalThreadId)) continue;
    const key = personKey(r.externalThreadId);
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  const plans: MergePlan[] = [];
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const ranked = [...group].sort(
      (a, b) =>
        b.messages - a.messages ||
        Number(whatsAppDigits(`+${b.externalThreadId}`) === b.externalThreadId) -
          Number(whatsAppDigits(`+${a.externalThreadId}`) === a.externalThreadId) ||
        (b.lastMessageAt?.getTime() ?? 0) - (a.lastMessageAt?.getTime() ?? 0)
    );
    const [survivor, ...rest] = ranked;
    plans.push({
      survivorId: survivor.id,
      survivorThreadId: survivor.externalThreadId,
      merge: rest.map((r) => ({ id: r.id, externalThreadId: r.externalThreadId, messages: r.messages })),
    });
  }
  return plans;
};
