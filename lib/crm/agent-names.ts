import { prisma } from "@/lib/db";

/**
 * Labels for the ids an approval card shows («Para: Laura Gómez»). A
 * specialist's tool call reaches the panel without the lookups that named
 * those ids, so the card asks here. Contacts and WhatsApp chats only; ids the
 * caller can't name are left out.
 */
export const AGENT_NAMES_MAX = 20;

export const agentNames = async (ids: readonly string[]): Promise<Record<string, string>> => {
  const unique = [...new Set(ids.filter((id) => /^[A-Za-z0-9_-]{6,80}$/.test(id)))].slice(0, AGENT_NAMES_MAX);
  if (unique.length === 0) return {};
  const [contacts, chats] = await Promise.all([
    prisma.contact.findMany({
      where: { id: { in: unique } },
      select: { id: true, firstName: true, lastName: true, phoneE164: true },
    }),
    prisma.conversation.findMany({
      where: { id: { in: unique }, channel: "WHATSAPP" },
      select: {
        id: true,
        externalThreadId: true,
        participantName: true,
        contact: { select: { firstName: true, lastName: true } },
      },
    }),
  ]);
  const out: Record<string, string> = {};
  for (const c of contacts) {
    const name = [c.firstName, c.lastName].filter(Boolean).join(" ").trim();
    out[c.id] = name ? (c.phoneE164 && !c.phoneE164.startsWith("+pending") && !c.phoneE164.startsWith("+nophone") ? `${name} (${c.phoneE164})` : name) : (c.phoneE164 ?? "Contacto sin nombre");
  }
  for (const c of chats) {
    const name = [c.contact?.firstName, c.contact?.lastName].filter(Boolean).join(" ").trim() || c.participantName?.trim();
    out[c.id] = name ? `${name} (+${c.externalThreadId})` : `+${c.externalThreadId}`;
  }
  return out;
};
