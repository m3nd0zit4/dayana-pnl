import { prisma } from "@/lib/db";
import { writeAuditLog } from "../audit";
import { getTeamPhones } from "../chat-category";
import { isTeamThread } from "../chat-category-rules";
import { getSiteSetting, setSiteSetting } from "../site-settings";
import { getWhatsAppAiConfig } from "../whatsapp-ai-config";
import { isIgnoredNumber } from "../whatsapp-ignored-numbers";
import { humanReplySql, notLearnableChatSql, repeatedRepliesSql } from "../whatsapp-learning";
import { normalizePlaybookName, SUPERSEDED, withoutSupersededRefs, type AiResetPlan, type ExampleReason } from "./ai-reset-rules";
import { DEFAULT_PLAYBOOKS } from "./playbooks";

export { EXAMPLE_REASON_LABEL, SUPERSEDED_PLAYBOOKS, type AiResetPlan, type ExampleReason } from "./ai-reset-rules";

/**
 * «Empezar limpio»: quitar lo que la IA aprendió mal para que aprenda del
 * historial real de Dayana (los chats exportados del celular y lo que ella
 * escribe de verdad).
 *
 * Qué limpia:
 * - las propuestas de procedimientos que la IA fue sacando de correcciones y
 *   que Dayana nunca aprobó (apagadas, repetidas, a veces contradictorias);
 * - los procedimientos básicos que ya están en las reglas de la IA y en el
 *   flujo de primera vez, solo si siguen con el texto original (se apagan, no
 *   se borran: Dayana los puede prender);
 * - los ejemplos de estilo que no son respuestas de Dayana: borradores de la
 *   IA, envíos automáticos, avisos, chats personales o del equipo, y textos
 *   pegados igual en muchos chats (respuestas rápidas, bienvenida);
 * - la memoria por persona que escribió la IA viendo solo los últimos
 *   mensajes (la reemplaza la ficha, que lee todo el chat);
 * - el modo Copiloto que se quedó pegado en los chats (con el error de antes,
 *   el modo general se copiaba a cada chat que escribía).
 *
 * Qué NO toca: los mensajes, los contactos, los pagos, la guía de estilo y las
 * instrucciones, los ejemplos que Dayana apagó, los procedimientos que escribió
 * o aprobó, las notas que escribió en una persona y el modo que eligió para un
 * chat. «Lo escribió o lo eligió Dayana» sale del registro de auditoría: la
 * tabla de memoria y el modo del chat no guardan quién los puso.
 *
 * Antes de cambiar nada guarda una copia de lo que quita (las últimas
 * `MAX_BACKUPS` limpiezas, en `whatsapp.ai.resetBackups`), y `undoAiReset`
 * deshace la última.
 */

export const RESET_BACKUPS_KEY = "whatsapp.ai.resetBackups";
const MAX_BACKUPS = 5;

type ExampleRow = {
  id: string;
  external_thread_id: string | null;
  ai_draft: boolean | null;
  auto_send: boolean | null;
  system: boolean | null;
  missing: boolean | null;
  not_work: boolean | null;
  template: boolean | null;
};

/** Los ejemplos que no son respuestas de Dayana en un chat de trabajo, con el porqué. */
const examplesToRemove = async (): Promise<{ id: string; reason: ExampleReason }[]> => {
  const rows = await prisma.$queryRaw<ExampleRow[]>`
    WITH repeated AS (${repeatedRepliesSql})
    SELECT e.id,
      c.external_thread_id,
      (m.id IS NOT NULL AND m.source = 'approval') AS ai_draft,
      (m.id IS NOT NULL AND m.kind <> 'system' AND m.source IS DISTINCT FROM 'approval' AND NOT (${humanReplySql})) AS auto_send,
      (m.id IS NOT NULL AND m.kind = 'system') AS system,
      (e.source = 'inbox' AND m.id IS NULL) AS missing,
      (c.id IS NOT NULL AND ${notLearnableChatSql}) AS not_work,
      (btrim(lower(regexp_replace(e.reply_text, '[[:space:]]+', ' ', 'g'))) IN (SELECT t FROM repeated)) AS template
    FROM whatsapp_reply_examples e
    LEFT JOIN conversation_messages m ON e.source = 'inbox' AND m.id = substring(e.source_key from 7)
    LEFT JOIN conversations c ON c.id = e.conversation_id
    LEFT JOIN whatsapp_dossiers d ON d.conversation_id = c.id
    WHERE e.is_enabled`;

  // Números personales (huella) y del equipo: se miran aquí, no en SQL.
  const teamPhones = await getTeamPhones().catch(() => [] as string[]);
  const threads = [...new Set(rows.map((r) => r.external_thread_id).filter((t): t is string => Boolean(t)))];
  const personal = new Set<string>();
  for (const t of threads) {
    if (isTeamThread(t, teamPhones) || (await isIgnoredNumber(t))) personal.add(t);
  }

  const out: { id: string; reason: ExampleReason }[] = [];
  for (const r of rows) {
    // Los booleanos de SQL pueden venir nulos: nulo = no.
    const reason: ExampleReason | null = r.ai_draft
      ? "ai_draft"
      : r.auto_send
        ? "auto_send"
        : r.system
          ? "system"
          : r.missing
            ? "missing_message"
            : r.not_work || (r.external_thread_id && personal.has(r.external_thread_id))
              ? "not_work_chat"
              : r.template
                ? "template"
                : null;
    if (reason) out.push({ id: r.id, reason });
  }
  return out;
};

/** Teléfonos cuya memoria tocó alguien del equipo (desde el chat o el asistente de Dayana). */
const memoriesByStaff = async (): Promise<Set<string>> => {
  const rows = await prisma.$queryRaw<{ phone: string }[]>`
    SELECT c.external_thread_id AS phone FROM audit_logs a
    JOIN conversations c ON c.id = a.entity_id
    WHERE a.entity_type = 'WhatsAppChat' AND jsonb_typeof(a.changes) = 'object' AND a.changes ? 'memory'
    UNION
    SELECT a.entity_id AS phone FROM audit_logs a WHERE a.entity_type = 'WhatsAppMemory'`;
  return new Set(rows.map((r) => r.phone));
};

/** Chats cuyo modo eligió alguien del equipo (antes de `aiModeOverride` no quedaba en el chat). */
const modesByStaff = async (): Promise<Set<string>> => {
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    SELECT DISTINCT a.entity_id AS id FROM audit_logs a
    WHERE a.entity_type = 'WhatsAppChat' AND jsonb_typeof(a.changes) = 'object' AND a.changes ? 'aiMode'`;
  return new Set(rows.map((r) => r.id));
};

/** Propuestas que Dayana aprobó alguna vez (aunque después las haya apagado). */
const playbooksApproved = async (): Promise<Set<string>> => {
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    SELECT DISTINCT a.entity_id AS id FROM audit_logs a
    WHERE a.entity_type = 'WhatsAppPlaybook' AND jsonb_typeof(a.changes) = 'object'
      AND (a.changes->>'isEnabled' = 'true' OR a.changes ? 'steps' OR a.changes ? 'name')`;
  return new Set(rows.map((r) => r.id));
};

const sameText = (a: string, b: string) => a.replace(/\s+/g, " ").trim() === b.replace(/\s+/g, " ").trim();
const DEFAULT_STEPS = new Map(DEFAULT_PLAYBOOKS.map((p) => [normalizePlaybookName(p.name), p.steps]));
/** ¿Sigue con el texto con que se sembró? Si Dayana lo cambió, es suyo y se queda. */
const isUntouchedDefault = (p: { name: string; steps: string }) => {
  const original = DEFAULT_STEPS.get(normalizePlaybookName(p.name));
  return original !== undefined && sameText(original, p.steps);
};

const loadPlan = async () => {
  const [playbooks, approved, removeExamples, totalExamples, disabledExamples, memories, staffMemories, sticky, staffModes, config] =
    await Promise.all([
      prisma.whatsAppPlaybook.findMany({ orderBy: { createdAt: "asc" } }),
      playbooksApproved(),
      examplesToRemove(),
      prisma.whatsAppReplyExample.count(),
      prisma.whatsAppReplyExample.count({ where: { isEnabled: false } }),
      prisma.whatsAppMemory.findMany(),
      memoriesByStaff(),
      prisma.conversation.findMany({ where: { channel: "WHATSAPP", aiMode: "COPILOT", aiModeOverride: null }, select: { id: true } }),
      modesByStaff(),
      getWhatsAppAiConfig(),
    ]);
  const proposals = playbooks.filter((p) => p.source === "learned" && !p.isEnabled && !approved.has(p.id));
  const superseded = playbooks.filter((p) => p.isEnabled && SUPERSEDED.has(normalizePlaybookName(p.name)) && isUntouchedDefault(p));
  const supersededIds = new Set(superseded.map((p) => p.id));
  const kept = playbooks.filter((p) => p.isEnabled && !supersededIds.has(p.id));
  // Solo se quita la referencia a lo que de verdad se apaga.
  const offNames = superseded.map((p) => p.name);
  const textFixes = kept.filter((p) => withoutSupersededRefs(p.steps, offNames) !== p.steps);
  const aiMemories = memories.filter((m) => !staffMemories.has(m.phone));
  const stickyIds = sticky.map((c) => c.id).filter((id) => !staffModes.has(id));
  const byReason: Partial<Record<ExampleReason, number>> = {};
  for (const e of removeExamples) byReason[e.reason] = (byReason[e.reason] ?? 0) + 1;
  const plan: AiResetPlan = {
    proposals: proposals.map(({ id, name }) => ({ id, name })),
    superseded: superseded.map(({ id, name }) => ({ id, name })),
    textFixes: textFixes.map(({ id, name }) => ({ id, name })),
    examples: { total: totalExamples, remove: removeExamples.length, byReason },
    memories: aiMemories.length,
    stickyModes: stickyIds.length,
    kept: {
      playbooks: kept.map((p) => p.name),
      styleGuide: config.styleGuide,
      instructions: config.instructions,
      disabledExamples,
      staffMemories: memories.length - aiMemories.length,
      staffModes: sticky.length - stickyIds.length,
    },
  };
  return { plan, proposals, superseded, offNames, textFixes, removeExamples, aiMemories, stickyIds };
};

/** Qué haría la limpieza, sin tocar nada. */
export const planAiReset = async (): Promise<AiResetPlan> => (await loadPlan()).plan;

type Backup = {
  at: string;
  staffId: string | null;
  playbooks: {
    deleted: unknown[];
    /** Los básicos apagados, con su texto: al deshacer solo se prenden si nadie los tocó. */
    disabled: { id: string; steps: string }[];
    /** Texto antes y después de quitar la referencia. */
    textBefore: { id: string; steps: string; after: string }[];
  };
  examples: {
    id: string;
    sourceKey: string;
    source: string;
    conversationId: string | null;
    clientText: string;
    replyText: string;
    repliedAt: string;
    createdAt: string;
  }[];
  memories: { phone: string; contactId: string | null; notes: string; updatedAt: string }[];
  stickyModes: string[];
};

const readBackups = async (): Promise<Backup[]> => {
  const raw = await getSiteSetting(RESET_BACKUPS_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as Backup[]) : [];
  } catch {
    return [];
  }
};
const writeBackups = (backups: Backup[]) => setSiteSetting(RESET_BACKUPS_KEY, JSON.stringify(backups.slice(-MAX_BACKUPS)));

export type AiResetResult = {
  plan: AiResetPlan;
  backupAt: string;
  removed: { proposals: number; superseded: number; examples: number; memories: number; stickyModes: number };
};

/**
 * Limpia. `memories: false` deja también la memoria que escribió la IA.
 * Guarda la copia antes de cambiar nada; si algo falla, no queda nada a medias
 * (una transacción) y la copia se retira.
 */
export const applyAiReset = async (opts: { memories: boolean; staffId: string | null }): Promise<AiResetResult> => {
  const { plan, proposals, superseded, offNames, textFixes, removeExamples, aiMemories, stickyIds } = await loadPlan();
  const memories = opts.memories ? aiMemories : [];
  const examples = await prisma.whatsAppReplyExample.findMany({
    where: { id: { in: removeExamples.map((e) => e.id) } },
    select: { id: true, sourceKey: true, source: true, conversationId: true, clientText: true, replyText: true, repliedAt: true, createdAt: true },
  });

  const backup: Backup = {
    at: new Date().toISOString(),
    staffId: opts.staffId,
    playbooks: {
      deleted: proposals,
      disabled: superseded.map((p) => ({ id: p.id, steps: p.steps })),
      textBefore: textFixes.map((p) => ({ id: p.id, steps: p.steps, after: withoutSupersededRefs(p.steps, offNames) })),
    },
    examples: examples.map((e) => ({ ...e, repliedAt: e.repliedAt.toISOString(), createdAt: e.createdAt.toISOString() })),
    memories: memories.map((m) => ({ phone: m.phone, contactId: m.contactId, notes: m.notes, updatedAt: m.updatedAt.toISOString() })),
    stickyModes: stickyIds,
  };
  const previous = await readBackups();
  await writeBackups([...previous, backup]);

  try {
    await prisma.$transaction(
      async (tx) => {
        if (proposals.length) await tx.whatsAppPlaybook.deleteMany({ where: { id: { in: proposals.map((p) => p.id) } } });
        if (superseded.length) {
          await tx.whatsAppPlaybook.updateMany({ where: { id: { in: superseded.map((p) => p.id) } }, data: { isEnabled: false } });
        }
        for (const p of backup.playbooks.textBefore) {
          await tx.whatsAppPlaybook.update({ where: { id: p.id }, data: { steps: p.after, version: { increment: 1 } } });
        }
        if (examples.length) await tx.whatsAppReplyExample.deleteMany({ where: { id: { in: examples.map((e) => e.id) } } });
        if (memories.length) await tx.whatsAppMemory.deleteMany({ where: { phone: { in: memories.map((m) => m.phone) } } });
        if (stickyIds.length) {
          // Solo los que siguen pegados (si alguien eligió un modo para el chat mientras tanto, se respeta).
          await tx.conversation.updateMany({
            where: { id: { in: stickyIds }, aiMode: "COPILOT", aiModeOverride: null },
            data: { aiMode: "AUTO" },
          });
        }
      },
      { timeout: 60_000 }
    );
  } catch (e) {
    // No se cambió nada: la copia de esta vuelta sobra.
    await writeBackups(previous).catch(() => undefined);
    throw e;
  }

  const removed = {
    proposals: proposals.length,
    superseded: superseded.length,
    examples: examples.length,
    memories: memories.length,
    stickyModes: stickyIds.length,
  };
  await writeAuditLog({
    staffUserId: opts.staffId ?? undefined,
    action: "UPDATE",
    entityType: "WhatsAppAi",
    entityId: "reset",
    changes: { reset: removed, backupAt: backup.at },
  }).catch(() => undefined);
  return { plan, backupAt: backup.at, removed };
};

/** La copia de la última limpieza (o null). */
export const lastAiResetBackup = async (): Promise<Backup | null> => (await readBackups()).at(-1) ?? null;

/**
 * Deshace la última limpieza con su copia: vuelven las propuestas, los
 * ejemplos (su vector se recalcula solo), la memoria y el modo de los chats.
 * Lo que alguien cambió después no se pisa: un procedimiento que Dayana editó
 * o volvió a prender se queda como está, un ejemplo o una memoria que ya
 * existen no se reemplazan, y un chat al que se le eligió modo no se toca.
 */
export const undoAiReset = async (staffId: string | null) => {
  const backups = await readBackups();
  const backup = backups.at(-1);
  if (!backup) return null;
  type DeletedPlaybook = { id: string; name: string; trigger: string; steps: string; isEnabled: boolean; source: string; version: number; createdAt: string };
  const deleted = backup.playbooks.deleted as DeletedPlaybook[];
  const skipped: string[] = [];
  await prisma.$transaction(
    async (tx) => {
      if (deleted.length) {
        await tx.whatsAppPlaybook.createMany({
          data: deleted.map((p) => ({
            id: p.id,
            name: p.name,
            trigger: p.trigger,
            steps: p.steps,
            isEnabled: p.isEnabled,
            source: p.source,
            version: p.version,
            createdAt: new Date(p.createdAt),
          })),
          skipDuplicates: true,
        });
      }
      for (const p of backup.playbooks.disabled) {
        const r = await tx.whatsAppPlaybook.updateMany({ where: { id: p.id, isEnabled: false, steps: p.steps }, data: { isEnabled: true } });
        if (r.count === 0) skipped.push(p.id);
      }
      for (const p of backup.playbooks.textBefore) {
        const r = await tx.whatsAppPlaybook.updateMany({ where: { id: p.id, steps: p.after }, data: { steps: p.steps } });
        if (r.count === 0) skipped.push(p.id);
      }
      if (backup.examples.length) {
        await tx.whatsAppReplyExample.createMany({
          data: backup.examples.map((e) => ({ ...e, repliedAt: new Date(e.repliedAt), createdAt: new Date(e.createdAt) })),
          skipDuplicates: true,
        });
      }
      if (backup.memories.length) {
        await tx.whatsAppMemory.createMany({
          data: backup.memories.map((m) => ({ phone: m.phone, contactId: m.contactId, notes: m.notes })),
          skipDuplicates: true,
        });
      }
      if (backup.stickyModes.length) {
        await tx.conversation.updateMany({
          where: { id: { in: backup.stickyModes }, aiMode: "AUTO", aiModeOverride: null },
          data: { aiMode: "COPILOT" },
        });
      }
    },
    { timeout: 60_000 }
  );
  await writeBackups(backups.slice(0, -1));
  await writeAuditLog({
    staffUserId: staffId ?? undefined,
    action: "UPDATE",
    entityType: "WhatsAppAi",
    entityId: "reset-undo",
    changes: { backupAt: backup.at, skippedPlaybooks: skipped },
  }).catch(() => undefined);
  return { backupAt: backup.at, skippedPlaybooks: skipped.length };
};
