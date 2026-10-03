/**
 * Vista previa de la clasificación de chats de WhatsApp, contra la base que
 * diga DATABASE_URL (sirve para producción).
 *
 *   bun scripts/chat-category-preview.ts --dry-run          solo reglas, no escribe nada
 *   bun scripts/chat-category-preview.ts --dry-run --ai     + la IA para los dudosos (cuesta centavos), sin escribir
 *   bun scripts/chat-category-preview.ts --apply            guarda lo que deciden las reglas (requiere la migración)
 *   bun scripts/chat-category-preview.ts --apply --ai       guarda reglas + IA
 *
 * Opciones: --samples N (20 por defecto); --show enseña nombres y el último
 * mensaje (por defecto van tapados: la salida puede acabar en un chat o un log).
 *
 * Sin `--apply` no se escribe NADA: solo hay lecturas (SELECT). Sin `--ai` no
 * se llama al modelo. Los chats en modo Manual nunca van al modelo. Nunca
 * toca lo marcado a mano.
 *
 * `--ai` (con --dry-run o --apply) manda conversaciones a Google, así que pide
 * lo mismo que la app: la clasificación encendida (`whatsapp.classify_enabled`)
 * y, contra una base cuyo nombre no lleva «dev», además `--i-know-prod`.
 */
import { prisma } from "@/lib/db";
import {
  categoryCounts,
  classifyPending,
  getTeamPhones,
  isClassifyEnabled,
  loadFactsBatch,
} from "@/lib/crm/chat-category";
import { classifyWithAi } from "@/lib/crm/chat-category-ai";
import {
  CHAT_CATEGORIES,
  classifyByRules,
  isSilencingCategory,
  needsReview,
  personMessages,
  signalHints,
  type CategoryVerdict,
  type ChatCategory,
} from "@/lib/crm/chat-category-rules";
import { effectiveAiMode } from "@/lib/crm/whatsapp-agent/mode";
import { getWhatsAppAiConfig } from "@/lib/crm/whatsapp-ai-config";

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
const SHOW = has("--show");
const SAMPLES = numArg("--samples", 20);

if (APPLY === DRY) {
  console.error("Indica --dry-run (solo lee) o --apply (escribe). Añade --ai para usar el modelo en los dudosos.");
  process.exit(2);
}

const dbUrl = (() => {
  try {
    return new URL(process.env.DATABASE_URL ?? "");
  } catch {
    return null;
  }
})();
const target = dbUrl ? `${dbUrl.hostname}${dbUrl.pathname}` : "(DATABASE_URL no válida)";
const isDevDb = Boolean(dbUrl?.pathname.toLowerCase().includes("dev"));

/** `--ai` manda chats a Google: mismas condiciones que la app, y producción solo a sabiendas. */
const guardAi = async () => {
  if (!AI) return;
  if (!isDevDb && !has("--i-know-prod")) {
    console.error(`--ai contra ${target}, que no parece de desarrollo: añade --i-know-prod si de verdad quieres.`);
    process.exit(2);
  }
  if (!(await isClassifyEnabled())) {
    console.error("La clasificación está apagada (whatsapp.classify_enabled): enciéndela en el CRM antes de usar --ai.");
    process.exit(2);
  }
};

/** +57300•••4567: lo justo para reconocerlo. */
const maskPhone = (thread: string) =>
  /^\d{8,15}$/.test(thread) ? `+${thread.slice(0, 5)}•••${thread.slice(-4)}` : `${thread.slice(0, 6)}…`;
const cut = (s: string | null | undefined, n: number) => {
  const t = (s ?? "").replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};
/** «Laura Gómez» → «L••• G•••» salvo con --show. */
const maskName = (s: string | null | undefined) =>
  SHOW ? cut(s, 18) : cut(s, 40).split(" ").filter(Boolean).slice(0, 3).map((w) => `${w[0]}•••`).join(" ");
/** El último mensaje solo con --show; si no, su largo. */
const lastLine = (s: string) => (SHOW ? `«${cut(s, 80)}»` : `(${s.length} caracteres; --show para verlo)`);

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
  await guardAi();
  console.log(`Guardando (${AI ? "reglas + IA" : "solo reglas"}) en ${target}…`);
  let rounds = 0;
  for (;;) {
    const r = await classifyPending({ limit: 40, budgetMs: 60_000, useAi: AI });
    rounds++;
    if (r.busy) {
      console.log("  otra tanda está clasificando (el reloj): espera un minuto y vuelve a correrlo.");
      break;
    }
    console.log(
      `  tanda ${rounds}: ${r.classified} clasificados (${r.byRule} reglas, ${r.byAi} IA, ${r.kept} conservados), ` +
        `${r.needsAi} esperan IA, ${r.failed} fallos, quedan ${r.remaining}` +
        `${r.models.length ? ` · ${r.models.join(", ")}` : ""}${r.aiBlocked ? ` · IA cortada: ${r.aiBlocked}` : ""}`
    );
    if (r.errors.length) console.log(`    errores: ${r.errors.join(" | ")}`);
    if (r.remaining === 0 || r.classified === 0 || r.aiBlocked || rounds >= 50) break;
  }
  const counts = await categoryCounts();
  console.log("\nAhora en la base:");
  for (const c of CHAT_CATEGORIES) console.log(`  ${c.padEnd(11)} ${counts.counts[c]}`);
  console.log(`  sin clasificar ${counts.unclassified} · revisar ${counts.review} · manuales ${counts.manual} · pendientes ${counts.pending}`);
};

type Row = {
  c: { id: string; externalThreadId: string; participantName: string | null };
  verdict: CategoryVerdict | null;
  ai?: CategoryVerdict & { model: string; review: boolean };
  manualMode: boolean;
  lastPerson: string;
};

const preview = async () => {
  await guardAi();
  const withColumns = await hasCategoryColumns();
  const conversations = await prisma.conversation.findMany({
    where: { channel: "WHATSAPP" },
    orderBy: { lastMessageAt: "desc" },
    select: {
      id: true,
      externalThreadId: true,
      contactId: true,
      participantName: true,
      lastInboundAt: true,
      aiMode: true,
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

  const [teamPhones, config] = await Promise.all([getTeamPhones(), getWhatsAppAiConfig()]);
  const rows: Row[] = [];
  const signalTally: Record<string, number> = {};
  for (let i = 0; i < conversations.length; i += 100) {
    const chunk = conversations.slice(i, i + 100);
    const facts = await loadFactsBatch(chunk, teamPhones);
    const chunkRows: Row[] = [];
    for (const c of chunk) {
      if (manual.has(c.id)) continue;
      const f = facts.get(c.id)!;
      for (const [k, v] of Object.entries(f.signals)) if (v === true) signalTally[k] = (signalTally[k] ?? 0) + 1;
      if (personMessages(f.messages).length > 0 || f.everWrote) signalTally.wrote = (signalTally.wrote ?? 0) + 1;
      const row: Row = {
        c,
        verdict: classifyByRules(f),
        manualMode: effectiveAiMode(c.aiMode, config.defaultMode) === "MANUAL",
        lastPerson: personMessages(f.messages).at(-1)?.body ?? "",
      };
      chunkRows.push(row);
      rows.push(row);
    }
    if (AI) {
      // Los chats en modo Manual nunca van al modelo.
      const undecided = chunkRows.filter((r) => !r.verdict && !r.manualMode);
      let next = 0;
      const worker = async () => {
        while (next < undecided.length) {
          const r = undecided[next++];
          const f = facts.get(r.c.id)!;
          try {
            const v = await classifyWithAi({ messages: f.messages, hints: signalHints(f) });
            r.ai = { category: v.category, confidence: v.confidence, reason: v.reason, model: v.model, review: v.review };
          } catch (e) {
            console.log(`  IA falló en ${maskPhone(r.c.externalThreadId)}: ${e instanceof Error ? e.message.slice(0, 120) : e}`);
          }
        }
      };
      await Promise.all(Array.from({ length: 4 }, worker));
    }
  }

  const DUDOSO = "(dudoso → IA)";
  const tally = (pick: (r: Row) => ChatCategory | null) => {
    const t: Record<string, number> = {};
    for (const r of rows) {
      const k = pick(r) ?? DUDOSO;
      t[k] = (t[k] ?? 0) + 1;
    }
    return t;
  };
  const show = (title: string, t: Record<string, number>) => {
    console.log(`\n${title}`);
    for (const k of [...CHAT_CATEGORIES, DUDOSO]) if (t[k]) console.log(`  ${k.padEnd(14)} ${t[k]}`);
  };

  console.log(`\nSeñales: ${Object.entries(signalTally).map(([k, v]) => `${k} ${v}`).join(" · ")}`);
  if (manual.size) console.log(`Marcados a mano (no se tocan): ${manual.size}`);
  const manualModeUndecided = rows.filter((r) => !r.verdict && r.manualMode).length;
  if (manualModeUndecided) console.log(`Dudosos en modo Manual (nunca van a la IA): ${manualModeUndecided}`);
  show("Solo reglas:", tally((r) => r.verdict?.category ?? null));
  const silencedByRules = rows.filter(
    (r) => r.verdict && isSilencingCategory({ category: r.verdict.category, categorySource: "rule", categoryConfidence: r.verdict.confidence, categoryReview: needsReview(r.verdict.category, r.verdict.confidence) }, { enabled: true })
  ).length;
  console.log(`  silenciarían en B2 (con la clasificación encendida): ${silencedByRules} — solo equipo y códigos / notificaciones`);
  if (AI) {
    show("Reglas + IA:", tally((r) => r.verdict?.category ?? r.ai?.category ?? null));
    const models = [...new Set(rows.flatMap((r) => (r.ai ? [r.ai.model] : [])))];
    const review = rows.filter((r) => r.ai?.review).length;
    const silencedByAi = rows.filter(
      (r) =>
        r.ai &&
        isSilencingCategory({ category: r.ai.category, categorySource: "ai", categoryConfidence: r.ai.confidence, categoryReview: r.ai.review }, { enabled: true })
    ).length;
    console.log(`  modelo: ${models.join(", ") || "—"} · por revisar: ${review} · la IA silenciaría (≥ 0,9): ${silencedByAi}`);
  }

  const reasons: Record<string, number> = {};
  for (const r of rows) if (r.verdict) reasons[r.verdict.reason] = (reasons[r.verdict.reason] ?? 0) + 1;
  console.log("\nMotivos de las reglas:");
  for (const [reason, n] of Object.entries(reasons).sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(4)}  ${reason}`);

  // Muestras repartidas: una de cada categoría por vuelta, y los dudosos.
  const groups = new Map<string, Row[]>();
  for (const r of rows) {
    const k = r.verdict?.category ?? "(dudoso)";
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  const samples: Row[] = [];
  for (let round = 0; samples.length < SAMPLES && round < SAMPLES; round++) {
    for (const list of groups.values()) if (list[round] && samples.length < SAMPLES) samples.push(list[round]);
  }
  console.log(`\n${samples.length} muestras${SHOW ? "" : " (nombres y mensajes tapados; --show para verlos)"}:`);
  for (const r of samples) {
    const v = r.verdict ?? r.ai;
    const tag = r.verdict ? "regla" : r.ai ? `IA ${r.ai.model}` : r.manualMode ? "dudoso · modo Manual" : "dudoso";
    const review = v && needsReview(v.category, v.confidence) ? " · revisar" : "";
    console.log(
      `  ${maskPhone(r.c.externalThreadId).padEnd(16)} ${maskName(r.c.participantName).padEnd(18)} ` +
        `${(v?.category ?? "—").padEnd(10)} ${v ? v.confidence.toFixed(2) : "    "} [${tag}${review}] ${v?.reason ?? ""}` +
        `${r.lastPerson ? `\n${" ".repeat(18)}↳ ${lastLine(r.lastPerson)}` : ""}`
    );
  }
  console.log("\nNo se escribió nada. Para guardar: --apply (y --ai para los dudosos, con la clasificación encendida).");
};

(APPLY ? apply() : preview())
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
