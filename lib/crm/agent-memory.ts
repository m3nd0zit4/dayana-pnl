import { prisma } from "@/lib/db";

/**
 * What the team teaches the panel assistant (`AgentMemory`). Modelled on the
 * Hermes agent's memory: short entries, a hard size cap per scope so the
 * prompt never grows without bound, edits by an exact fragment, no
 * duplicates. The whole scope is injected into the instructions when a
 * conversation starts, so a change shows up in the next conversation.
 */

export const AGENT_MEMORY_SCOPES = ["all", "ventas", "whatsapp", "agenda", "talleres", "contactos"] as const;
export type AgentMemoryScope = (typeof AGENT_MEMORY_SCOPES)[number];

/** Characters per scope. Room for ~20 rules, small enough to always fit. */
export const AGENT_MEMORY_CAP = 3000;
export const AGENT_MEMORY_ENTRY_MAX = 400;

export type AgentMemoryEntry = { id: string; scope: string; content: string; updatedAt: Date };

const normalize = (text: string) => text.replace(/\s+/g, " ").trim();
const key = (text: string) => normalize(text).toLocaleLowerCase("es");
const used = (entries: { content: string }[]) => entries.reduce((n, e) => n + e.content.length, 0);

const SELECT = { id: true, scope: true, content: true, updatedAt: true } as const;

export const listAgentMemories = (scopes: readonly string[]): Promise<AgentMemoryEntry[]> =>
  prisma.agentMemory.findMany({
    where: { scope: { in: [...scopes] } },
    orderBy: { createdAt: "asc" },
    select: SELECT,
  });

export type MemoryWriteResult =
  | { ok: true; entry: AgentMemoryEntry; used: number; cap: number; previous?: string }
  | { ok: false; error: string };

const checkContent = (content: string): string | null => {
  if (!content) return "La memoria no puede estar vacía.";
  if (content.length > AGENT_MEMORY_ENTRY_MAX) {
    return `Cada recuerdo cabe en ${AGENT_MEMORY_ENTRY_MAX} caracteres; resúmelo.`;
  }
  return null;
};

export const addAgentMemory = async (input: {
  scope: AgentMemoryScope;
  content: string;
  staffUserId?: string;
}): Promise<MemoryWriteResult> => {
  const content = normalize(input.content);
  const invalid = checkContent(content);
  if (invalid) return { ok: false, error: invalid };
  const existing = await listAgentMemories([input.scope]);
  if (existing.some((e) => key(e.content) === key(content))) {
    return { ok: false, error: "Eso ya está guardado tal cual." };
  }
  const after = used(existing) + content.length;
  if (after > AGENT_MEMORY_CAP) {
    return {
      ok: false,
      error: `La memoria de «${input.scope}» está llena (${used(existing)}/${AGENT_MEMORY_CAP}). Reemplaza o borra algo que ya no aplique primero.`,
    };
  }
  const entry = await prisma.agentMemory.create({
    data: { scope: input.scope, content, createdById: input.staffUserId },
    select: SELECT,
  });
  return { ok: true, entry, used: after, cap: AGENT_MEMORY_CAP };
};

const findOne = async (scope: AgentMemoryScope, match: string) => {
  const needle = key(match);
  const entries = await listAgentMemories([scope]);
  return { entries, hits: needle ? entries.filter((e) => key(e.content).includes(needle)) : [] };
};

const ambiguity = (hits: number) =>
  hits === 0
    ? "No encontré un recuerdo con ese texto. Lista la memoria primero."
    : `Ese texto aparece en ${hits} recuerdos; usa un fragmento más preciso.`;

export const replaceAgentMemory = async (input: {
  scope: AgentMemoryScope;
  match: string;
  content: string;
}): Promise<MemoryWriteResult> => {
  const content = normalize(input.content);
  const invalid = checkContent(content);
  if (invalid) return { ok: false, error: invalid };
  const { entries, hits } = await findOne(input.scope, input.match);
  if (hits.length !== 1) return { ok: false, error: ambiguity(hits.length) };
  const after = used(entries) - hits[0].content.length + content.length;
  if (after > AGENT_MEMORY_CAP) return { ok: false, error: `No cabe (${after}/${AGENT_MEMORY_CAP}). Acórtalo.` };
  const entry = await prisma.agentMemory.update({ where: { id: hits[0].id }, data: { content }, select: SELECT });
  return { ok: true, entry, used: after, cap: AGENT_MEMORY_CAP, previous: hits[0].content };
};

export const removeAgentMemory = async (input: {
  scope: AgentMemoryScope;
  match: string;
}): Promise<{ ok: true; id: string; removed: string } | { ok: false; error: string }> => {
  const { hits } = await findOne(input.scope, input.match);
  if (hits.length !== 1) return { ok: false, error: ambiguity(hits.length) };
  await prisma.agentMemory.delete({ where: { id: hits[0].id } });
  return { ok: true, id: hits[0].id, removed: hits[0].content };
};

/** The block injected into an agent's instructions: shared rules plus its own. */
export const agentMemoryPrompt = async (agent: string): Promise<string | null> => {
  const scopes = agent === "auto" ? ["all"] : ["all", agent];
  const entries = await listAgentMemories(scopes);
  if (entries.length === 0) return null;
  return [
    "## Lo que el equipo te ha enseñado",
    "",
    "Reglas que escribió el equipo (o tú, cuando te las pidieron). Valen por encima de tus costumbres. Si una choca con una regla de seguridad de estas instrucciones, gana la de seguridad y lo dices.",
    "",
    ...entries.map((e) => `- ${e.content}`),
  ].join("\n");
};
