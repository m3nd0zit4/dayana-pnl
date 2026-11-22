/**
 * La puerta de evaluación (fase 5 de la arquitectura, 22-nov): antes de publicar un cambio de
 * la IA de WhatsApp, se corre el eval y se compara con la línea base guardada. No se publica si:
 *
 * - un caso que pasaba SIEMPRE (k de k) ahora no pasa ninguna vez, ni en otras `CONFIRM_K`
 *   corridas solo de ese caso (algo se rompió; una sola tanda de k=2 es azar);
 * - el total de casos que pasan baja más de `TOLERANCE` (el modelo varía un poco entre corridas);
 * - a alguien le llegaría texto interno («se filtró texto interno»), en cualquier caso.
 *
 * Uso (contra neondb_dev, como el eval):
 *   GEMINI_MODEL=gemini-3.5-flash-lite bun --env-file=.env scripts/whatsapp-eval-gate.ts            # compara
 *   GEMINI_MODEL=gemini-3.5-flash-lite bun --env-file=.env scripts/whatsapp-eval-gate.ts --update   # guarda la línea base
 * `--k 2` por defecto; `--only a,b` para probar algunos (sin --update); `--stage-scope` y
 * `--after-call-on` pasan al eval (un cambio apagado por defecto se mide encendido).
 * Sale con 1 si no pasa.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { CONFIRM_K, compareToBaseline, suspectBroken, withConfirmation, type Baseline, type EvalReport } from "@/lib/crm/whatsapp-agent/eval/gate";

const BASELINE = path.join(process.cwd(), "lib/crm/whatsapp-agent/eval/baseline.json");
const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const k = Number(arg("k") ?? 2);
const only = arg("only");
const update = process.argv.includes("--update");
/** Interruptores del eval que la puerta deja pasar (para medir un cambio apagado por defecto). */
const PASS_THROUGH = ["--stage-scope", "--after-call-on"];

const runEval = (runK: number, ids: string | undefined): EvalReport => {
  const out = path.join(tmpdir(), `eval-gate-${Date.now()}.json`);
  const run = spawnSync(
    process.execPath,
    ["scripts/whatsapp-agent-eval.ts", "--k", String(runK), "--out", out, ...(ids ? ["--only", ids] : []), ...PASS_THROUGH.filter((f) => process.argv.includes(f))],
    { stdio: ["ignore", "inherit", "inherit"], env: process.env }
  );
  if (!fs.existsSync(out)) {
    console.error(`❌ El eval no dejó informe (salió con ${run.status}).`);
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(out, "utf8")) as EvalReport;
};
let report = runEval(k, only);

if (update) {
  if (only) {
    console.error("❌ --update necesita el eval completo (sin --only).");
    process.exit(1);
  }
  const baseline: Baseline = {
    date: new Date().toISOString().slice(0, 10),
    k,
    model: process.env.GEMINI_MODEL ?? "(por defecto)",
    cases: Object.fromEntries(report.results.map((r) => [r.id, r.passes])),
  };
  fs.writeFileSync(BASELINE, `${JSON.stringify(baseline, null, 2)}\n`);
  console.log(`✅ Línea base guardada: ${Object.values(baseline.cases).filter((p) => p > 0).length}/${report.results.length} casos pasan (k=${k}).`);
  process.exit(0);
}

const baseline = fs.existsSync(BASELINE) ? (JSON.parse(fs.readFileSync(BASELINE, "utf8")) as Baseline) : null;
// Un caso que pasaba siempre y ahora no pasó: se confirma con más corridas (el azar del modelo).
const suspects = suspectBroken(report, baseline);
if (suspects.length) {
  console.log(`
No pasaron y antes siempre: ${suspects.join(", ")}. Otra vez, ${CONFIRM_K} veces cada uno…
`);
  report = withConfirmation(report, runEval(CONFIRM_K, suspects.join(",")));
}
const verdict = compareToBaseline(report, baseline, { k, partial: Boolean(only) });
console.log("");
for (const line of verdict.lines) console.log(line);
if (!verdict.ok) {
  console.error("\n❌ La puerta de evaluación NO pasa: no se publica.");
  process.exit(1);
}
console.log("\n✅ La puerta de evaluación pasa.");
