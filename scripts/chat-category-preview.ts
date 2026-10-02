/**
 * Vista previa de la clasificación de chats de WhatsApp, contra la base que
 * diga DATABASE_URL (sirve para producción).
 *
 *   bun scripts/chat-category-preview.ts --dry-run          solo reglas, no escribe nada
 *   bun scripts/chat-category-preview.ts --dry-run --ai     + la IA para los dudosos (cuesta centavos), sin escribir
 *   bun scripts/chat-category-preview.ts --apply            guarda lo que deciden las reglas (requiere la migración)
 *   bun scripts/chat-category-preview.ts --apply --ai       guarda reglas + IA (lo mismo que «Clasificar todo»)
 *
 * Opciones: --samples N (20 por defecto).
 *
 * Sin `--apply` no se escribe NADA: solo hay lecturas (SELECT). Sin `--ai` no
 * se llama al modelo. Nunca toca lo marcado a mano.
 */
import { prisma } from "@/lib/db";
import {
  categoryCounts,
  classifyPending,
  getTeamPhones,
  loadFactsBatch,
  type ConversationBase,
} from "@/lib/crm/chat-category";
import { classifyWithAi } from "@/lib/crm/chat-category-ai";
import {
  CHAT_CATEGORIES,
  classifyByRules,
  personMessages,
  signalHints,
  type CategoryVerdict,
  type ChatCategory,
} from "@/lib/crm/chat-category-rules";

const args = process.argv.slice(2);
const has = (flag: string) => args.includes(flag);
const numArg = (flag: string, fallback: number) => {
  const i = args.indexOf(flag);
  const n = i >= 0 ? Number(args[i + 1]) : NaN;
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

const APPLY = has("--apply");
const DRY = has("--dry-run");
const AI = has("--ai");
const SAMPLES = numArg("--samples", 20);

if (APPLY === DRY) {
  console.error("Indica --dry-run (solo lee) o --apply (escribe). Añade --ai para usar el modelo en los dudosos.");
  process.exit(2);
}

const target = (() => {
  try {
    const u = new URL(process.env.DATABASE_URL ?? "");
    return `${u.hostname}${u.pathname}`;
  } catch {
    return "(DATABASE_URL no válida)";
  }
})();

/** +57300•••4567: lo justo para reconocerlo. */
const maskPhone = (thread: string) =>
  /^\d{8,15}$/.test(thread) ? `+${thread.slice(0, 5)}•••${thread.slice(-4)}` : thread.slice(0, 6) + "…";
const cut = (s: string | null | undefined, n: number) => {
  const t = (s ?? "").replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

const hasCategoryColumns = async () => {
  const rows = await prisma.$queryRaw<{ n: number }[]>`
    SELECT count(*)::int AS n FROM information_schema.columns
    WHERE table_name = 'conversations' AND column_name = 'category_source'`;
  return (rows[0]?.n ?? 0) > 0;
};

const apply = async () => {
  if (!(await hasCategoryColumns())) {
    console.error("La base no tiene la migración 20261013110000_chat_category: no hay dónde guardar.");
    process.exit(2);
  }
  console.log(`Guardando (${AI ? "reglas + IA" : "solo reglas"}) en ${target}…`);
  let rounds = 0;
  for (;;) {
    const r = await classifyPending({ limit: 40, budgetMs: 60_000, useAi: AI });
    rounds++;
    console.log(
      `  tanda ${rounds}: ${r.classified} clasificados (${r.byRule} reglas, ${r.byAi} IA, ${r.kept} conservados), ` +
        `${r.needsAi} esperan IA, ${r.failed} fallos, quedan ${r.remaining}${r.models.length ? ` · ${r.models.join(", ")}` : ""}`
    );
    if (r.errors.length) console.log(`    errores: ${r.errors.join(" | ")}`);
    if (r.remaining === 0 || r.classified === 0 || rounds >= 50) break;
  }
  const counts = await categoryCounts();
  console.log("\nAhora en la base:");
  for (const c of CHAT_CATEGORIES) console.log(`  ${c.padEnd(11)} ${counts.counts[c]}`);
  console.log(`  sin clasificar ${counts.unclassified} · revisar ${counts.review} · manuales ${counts.manual} · pendientes ${counts.pending}`);
};

const preview = async () => {
  const withColumns = await hasCategoryColumns();
  const conversations: ConversationBase[] = await prisma.conversation.findMany({
    where: { channel: "WHATSAPP" },
    orderBy: { lastMessageAt: "desc" },
    select: {
      id: true,
      channel: true,
      externalThreadId: true,
      contactId: true,
      participantName: true,
      lastMessageAt: true,
      lastInboundAt: true,
    },
  });
  // Las marcadas a mano no se tocan nunca: se cuentan aparte.
  const manual = withColumns
    ? new Set(
        (
          await prisma.$queryRaw<{ id: string }[]>`
            SELECT id FROM conversations WHERE channel = 'WHATSAPP' AND category_source = 'manual'`
        ).map((r) => r.id)
      )
    : new Set<string>();

  console.log(`Base: ${target} · ${conversations.length} chats de WhatsApp · solo lectura${AI ? " · IA para los dudosos" : ""}`);
  if (!withColumns) console.log("(La base aún no tiene las columnas de categoría: nada se puede guardar todavía.)");

  const teamPhones = await getTeamPhones();
  const rows: { c: ConversationBase; verdict: CategoryVerdict | null; ai?: CategoryVerdict & { model: string }; lastPerson: string }[] = [];
  const signalTally: Record<string, number> = {};
  for (let i = 0; i < conversations.length; i += 100) {
    const chunk = conversations.slice(i, i + 100);
    const facts = await loadFactsBatch(chunk, teamPhones);
    for (const c of chunk) {
      if (manual.has(c.id)) continue;
      const f = facts.get(c.id)!;
      for (const [k, v] of Object.entries(f.signals)) if (v === true) signalTally[k] = (signalTally[k] ?? 0) + 1;
      if (personMessages(f.messages).length > 0 || f.everWrote) signalTally.wrote = (signalTally.wrote ?? 0) + 1;
      rows.push({ c, verdict: classifyByRules(f), lastPerson: personMessages(f.messages).at(-1)?.body ?? "" });
    }
    if (AI) {
      const undecided = rows.filter((r) => !r.verdict && !r.ai && chunk.includes(r.c));
      let next = 0;
      const worker = async () => {
        while (next < undecided.length) {
          const r = undecided[next++];
          const f = facts.get(r.c.id)!;
          try {
            const v = await classifyWithAi({ messages: f.messages, hints: signalHints(f) });
            r.ai = { category: v.category, confidence: v.confidence, reason: v.reason, model: v.model };
          } catch (e) {
            console.log(`  IA falló en ${maskPhone(r.c.externalThreadId)}: ${e instanceof Error ? e.message.slice(0, 120) : e}`);
          }
        }
      };
      await Promise.all(Array.from({ length: 4 }, worker));
    }
  }

  const tally = (pick: (r: (typeof rows)[number]) => ChatCategory | null) => {
    const t: Record<string, number> = {};
    for (const r of rows) {
      const k = pick(r) ?? "(dudoso → IA)";
      t[k] = (t[k] ?? 0) + 1;
    }
    return t;
  };
  const show = (title: string, t: Record<string, number>) => {
    console.log(`\n${title}`);
    for (const k of [...CHAT_CATEGORIES, "(dudoso → IA)"]) if (t[k]) console.log(`  ${k.padEnd(14)} ${t[k]}`);
  };

  console.log(`\nSeñales: ${Object.entries(signalTally).map(([k, v]) => `${k} ${v}`).join(" · ")}`);
  if (manual.size) console.log(`Marcados a mano (no se tocan): ${manual.size}`);
  show("Solo reglas:", tally((r) => r.verdict?.category ?? null));
  if (AI) {
    show("Reglas + IA:", tally((r) => r.verdict?.category ?? r.ai?.category ?? null));
    const models = [...new Set(rows.flatMap((r) => (r.ai ? [r.ai.model] : [])))];
    const review = rows.filter((r) => r.ai && r.ai.confidence < 0.7).length;
    console.log(`  modelo: ${models.join(", ") || "—"} · por revisar (< 0,7): ${review}`);
  }

  const reasons: Record<string, number> = {};
  for (const r of rows) if (r.verdict) reasons[r.verdict.reason] = (reasons[r.verdict.reason] ?? 0) + 1;
  console.log("\nMotivos de las reglas:");
  for (const [reason, n] of Object.entries(reasons).sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(4)}  ${reason}`);

  // Muestras repartidas: una de cada categoría por vuelta, y los dudosos.
  const groups = new Map<string, typeof rows>();
  for (const r of rows) {
    const k = r.verdict?.category ?? "(dudoso)";
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  const samples: typeof rows = [];
  for (let round = 0; samples.length < SAMPLES && round < SAMPLES; round++) {
    for (const list of groups.values()) if (list[round] && samples.length < SAMPLES) samples.push(list[round]);
  }
  console.log(`\n${samples.length} muestras:`);
  for (const r of samples) {
    const v = r.verdict ?? r.ai;
    const tag = r.verdict ? "regla" : r.ai ? `IA ${r.ai.model}` : "dudoso";
    console.log(
      `  ${maskPhone(r.c.externalThreadId).padEnd(16)} ${cut(r.c.participantName, 18).padEnd(18)} ` +
        `${(v?.category ?? "—").padEnd(10)} ${v ? v.confidence.toFixed(2) : "    "} [${tag}] ${v?.reason ?? ""}` +
        `${r.lastPerson ? `\n${" ".repeat(18)}↳ «${cut(r.lastPerson, 80)}»` : ""}`
    );
  }
  console.log("\nNo se escribió nada. Para guardar: --apply (y --ai para los dudosos).");
};

(APPLY ? apply() : preview())
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
