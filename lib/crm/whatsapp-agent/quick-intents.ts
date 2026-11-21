import { asksToJoinCommunity, COMMUNITY_REPLY } from "./community";

/**
 * Pedidos simples con una sola respuesta correcta, que se contestan por código antes de
 * cualquier otra regla (dueña, 21-nov: «si piden unirse a la comunidad, el link
 * independientemente del historial de la conversación»).
 *
 * Antes este pedido pasaba por todas las compuertas de la IA y se perdía: Naty y Leidy
 * (después de su llamada: la IA callada) no recibieron nada, a «Huevos…» le llegó
 * «¿Pudiste hablar con Dayana?» y a Gimena «En un momento te llama» de la sala de espera.
 *
 * Puro: decide con los últimos mensajes del chat; el envío está en `run.ts`.
 */

export type QuickLine = {
  direction: string;
  body: string | null;
  sentAt: Date;
  externalMessageId?: string | null;
  status?: string | null;
};

export type QuickIntent = {
  kind: "community";
  reply: string;
  link: string;
  /** Lo que pidió además (para que Dayana lo vea), o null. */
  rest: string | null;
};

/** No se repite el enlace si ya salió hace poco (una ráfaga «agrégame» + «porfa» manda uno). */
const RECENT_LINK_MS = 30 * 60_000;

/** El pedido de la comunidad dentro de un texto más largo («me puedes unir al grupo»). */
const COMMUNITY_SENTENCE =
  /(?:\b(?:me|nos)\s+)?(?:\b(?:pued\w*|podri\w*|quiero|quisiera)\s+)?\b(?:agreg\w*|unir\w*|ingres\w*|entrar|pertenecer|meter\w*|link|enlace)[^.!?\n]{0,25}?\b(?:comunidad|grupo)\b/gi;

export const quickIntentFor = (input: {
  /** Los últimos mensajes del chat, del más viejo al más nuevo. */
  recent: QuickLine[];
  /** El mensaje que despertó este turno (`external_message_id`). */
  triggerMessageId: string;
  /** El enlace de la comunidad (Ajustes), o null si no hay. */
  community: string | null;
  now: Date;
}): QuickIntent | null => {
  if (!input.community) return null;
  const lines = input.recent.filter((l) => l.status !== "FAILED");
  const last = lines[lines.length - 1];
  // Solo si lo último del chat es de la persona (si alguien ya contestó, no).
  if (!last || last.direction !== "INBOUND") return null;
  // La ráfaga: lo que escribió desde el último mensaje nuestro.
  let i = lines.length;
  while (i > 0 && lines[i - 1].direction === "INBOUND") i--;
  const burst = lines.slice(i).map((l) => l.body ?? "").filter(Boolean);
  if (burst.length === 0 || !asksToJoinCommunity(burst)) return null;
  // El enlace ya salió hace poco: no otra vez (Dayana o la IA lo mandaron).
  const link = input.community;
  const sentRecently = lines.some(
    (l) => l.direction === "OUTBOUND" && (l.body ?? "").includes(link) && input.now.getTime() - l.sentAt.getTime() < RECENT_LINK_MS
  );
  if (sentRecently) return null;
  // ¿Pidió algo más en la misma ráfaga? Dayana lo ve en «Te toca».
  const rest = burst
    .join("\n")
    .replace(COMMUNITY_SENTENCE, " ")
    .replace(/\b(hola|buenas?( tardes| noches| dias)?|por ?favor|porfa|gracias|muchas|y|me|puedes|podrias|podrian)\b/gi, " ")
    .replace(/[^\p{L}\p{N}?]+/gu, " ")
    .trim();
  return { kind: "community", reply: COMMUNITY_REPLY, link, rest: rest.replace(/[^\p{L}]/gu, "").length >= 15 ? rest : null };
};
