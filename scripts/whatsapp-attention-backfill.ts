/**
 * Pone al día «Te toca» con los mismos UPDATE de la migración
 * `20261013100000_whatsapp_attention`.
 *
 * El build aplica la migración ANTES de que el código nuevo empiece a servir:
 * lo que pase en ese rato (una escalada, una respuesta de Dayana) lo hace el
 * código viejo, que no sabe de «Te toca». Correr esto justo después de
 * promover el despliegue lo deja al día. Es repetible: con el código nuevo ya
 * sirviendo, volver a correrlo no cambia lo que él mantiene.
 *
 *   bun scripts/whatsapp-attention-backfill.ts            (prueba: dice qué cambiaría y no toca nada)
 *   bun scripts/whatsapp-attention-backfill.ts --apply    (lo aplica)
 *
 * Usa el DATABASE_URL del entorno: mira la base que imprime antes de aplicar.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { prisma } from "@/lib/db";

const apply = process.argv.includes("--apply");
const MIGRATION = path.join(process.cwd(), "prisma/migrations/20261013100000_whatsapp_attention/migration.sql");

type Step = { label: string; sql: string };

/** Las sentencias de la migración, cada una con el comentario que la explica. */
const steps = (): Step[] => {
  const out: Step[] = [];
  for (const block of readFileSync(MIGRATION, "utf8").split(/;\s*(?:\r?\n|$)/)) {
    const lines = block.split(/\r?\n/);
    const label = lines.find((l) => /^--\s*\d/.test(l.trim()))?.replace(/^--\s*/, "").trim();
    const sql = lines.filter((l) => !l.trim().startsWith("--")).join("\n").trim();
    if (sql) out.push({ label: label ?? sql.split("\n")[0].slice(0, 70), sql });
  }
  return out;
};

class DryRun extends Error {}

const n = (v: unknown) => Number(v ?? 0);

const summary = async () => {
  const [row] = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(`
    SELECT
      COUNT(*) FILTER (WHERE attention_at IS NOT NULL) AS te_toca,
      COUNT(*) FILTER (WHERE ai_paused_reason = 'escalation') AS escaladas,
      COUNT(*) FILTER (WHERE ai_paused_reason = 'escalation'
        AND (COALESCE(escalation_category, '') IN ('clinical', 'payment') OR escalation_severity = 'urgent')) AS escaladas_delicadas,
      COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM whatsapp_ai_runs r
        WHERE r.conversation_id = conversations.id AND r.status = 'AWAITING_APPROVAL')) AS con_propuesta
    FROM conversations WHERE channel = 'WHATSAPP'`);
  return {
    teToca: n(row?.te_toca),
    escaladas: n(row?.escaladas),
    escaladasDelicadas: n(row?.escaladas_delicadas),
    conPropuesta: n(row?.con_propuesta),
  };
};

const main = async () => {
  const [db] = await prisma.$queryRawUnsafe<{ db: string }[]>(`SELECT current_database()::text AS db`);
  console.log(`Base: ${db?.db} · ${apply ? "APLICAR" : "prueba (no cambia nada; --apply para aplicar)"}\n`);
  console.log("Antes:", await summary());

  const results: { label: string; rows: number; sample: string[] }[] = [];
  try {
    await prisma.$transaction(
      async (tx) => {
        for (const step of steps()) {
          if (!/^UPDATE\b/i.test(step.sql)) {
            await tx.$executeRawUnsafe(step.sql);
            continue;
          }
          const returning = /^UPDATE\s+"conversations"\s+c\b/i.test(step.sql) ? `c."id"` : `"id"`;
          const rows = await tx.$queryRawUnsafe<{ id: string }[]>(`${step.sql}\nRETURNING ${returning}`);
          results.push({ label: step.label, rows: rows.length, sample: rows.slice(0, 10).map((r) => r.id) });
        }
        if (!apply) throw new DryRun();
      },
      { timeout: 120_000, maxWait: 20_000 }
    );
  } catch (e) {
    if (!(e instanceof DryRun)) throw e;
  }

  console.log("");
  for (const r of results) {
    console.log(`${apply ? "✔" : "·"} ${r.label}\n    ${r.rows} chats${r.sample.length ? ` (p. ej. ${r.sample.join(", ")})` : ""}`);
  }
  console.log("\nDespués:", apply ? await summary() : "(prueba: nada cambió)");
};

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  }
);
