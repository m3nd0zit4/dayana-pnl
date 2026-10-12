import { prisma } from "@/lib/db";
import { whatsAppIdVariants } from "@/lib/whatsapp-contact";

/**
 * Una persona, un chat.
 *
 * El mismo número puede llegar en varias formas (México 52/521, Argentina
 * 54/549, Brasil con y sin 9) y, con los nombres de usuario de WhatsApp, a
 * veces solo con el id de usuario (BSUID). Si cada forma abre su propio chat,
 * la IA lee un hilo vacío y saluda como si fuera la primera vez.
 *
 * Por eso, antes de guardar un mensaje se busca el chat que YA existe bajo
 * cualquiera de esas formas (y de los ids alternos del mensaje). Si no hay
 * ninguno, se usa el id tal cual llegó.
 */

/** Candidatos en orden: el id tal cual, sus variantes y luego los alternos. */
export const whatsAppThreadCandidates = (threadId: string, alts: string[] = []): string[] => [
  ...new Set([threadId, ...alts].flatMap((id) => whatsAppIdVariants(id))),
];

/** Elige, entre los chats que existen, el del candidato con más prioridad. */
export const pickExistingThread = (candidates: string[], existing: string[]): string | null => {
  const set = new Set(existing);
  return candidates.find((c) => set.has(c)) ?? null;
};

export const resolveWhatsAppThreadId = async (threadId: string, alts: string[] = []): Promise<string> => {
  const candidates = whatsAppThreadCandidates(threadId, alts);
  if (candidates.length <= 1) return threadId;
  const found = await prisma.conversation.findMany({
    where: { channel: "WHATSAPP", externalThreadId: { in: candidates } },
    select: { externalThreadId: true },
  });
  return pickExistingThread(candidates, found.map((f) => f.externalThreadId)) ?? threadId;
};
