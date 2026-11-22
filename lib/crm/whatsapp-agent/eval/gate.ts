/**
 * La comparación de la puerta de evaluación (`scripts/whatsapp-eval-gate.ts`), pura: el
 * informe de una corrida del eval contra la línea base guardada (`baseline.json`).
 */

export type EvalReport = {
  results: { id: string; passes: number; runs: { failed: string[] }[] }[];
};

export type Baseline = {
  date: string;
  k: number;
  model: string;
  /** Cuántas de las k corridas pasó cada caso. */
  cases: Record<string, number>;
};

/** Cuántos casos menos que la línea base se aceptan (el modelo varía un poco). */
export const TOLERANCE = 2;
/**
 * Un caso que pasaba siempre y ahora no pasó ninguna de las k veces se vuelve a correr
 * `CONFIRM_K` veces antes de llamarlo roto (22-nov: con k=2, la misma versión sin cambios dio
 * «se rompieron» 3 casos que en la corrida siguiente pasaban: era el azar del modelo).
 */
export const CONFIRM_K = 4;
export const LEAK = "se filtró texto interno";

/** Los casos que habría que dar por rotos (pasaban k de k, ahora ninguna vez). */
export const suspectBroken = (report: EvalReport, baseline: Baseline | null): string[] =>
  baseline ? report.results.filter((r) => baseline.cases[r.id] === baseline.k && r.passes === 0).map((r) => r.id) : [];

/**
 * Junta la segunda corrida de los sospechosos: el que pasó alguna vez no está roto (cuenta
 * como que pasa), y lo que la persona recibiría en esa segunda corrida también se revisa
 * (texto interno).
 */
export const withConfirmation = (report: EvalReport, rerun: EvalReport): EvalReport => {
  const again = new Map(rerun.results.map((r) => [r.id, r]));
  return {
    results: report.results.map((r) => {
      const a = again.get(r.id);
      return a ? { ...r, passes: a.passes > 0 ? 1 : 0, runs: [...r.runs, ...a.runs] } : r;
    }),
  };
};

export const compareToBaseline = (
  report: EvalReport,
  baseline: Baseline | null,
  opts: { k: number; partial?: boolean }
): { ok: boolean; lines: string[] } => {
  const lines: string[] = [];
  let ok = true;
  // Texto interno: nunca, en ningún caso.
  const leaks = report.results.filter((r) => r.runs.some((run) => run.failed.some((f) => f.startsWith(LEAK))));
  if (leaks.length) {
    ok = false;
    lines.push(`❌ Texto interno en lo que recibiría la persona: ${leaks.map((r) => r.id).join(", ")}`);
  }
  const passing = report.results.filter((r) => r.passes > 0).length;
  lines.push(`Casos que pasan: ${passing}/${report.results.length} (k=${opts.k}).`);
  if (!baseline) {
    lines.push("Sin línea base todavía: se compara solo el texto interno. Guárdala con --update.");
    return { ok, lines };
  }
  if (baseline.k !== opts.k) lines.push(`⚠️ La línea base es con k=${baseline.k}; esta corrida con k=${opts.k}.`);
  // Un caso que pasaba siempre y ahora no pasa nunca: algo se rompió.
  const broken = report.results.filter((r) => suspectBroken({ results: [r] }, baseline).length > 0);
  if (broken.length) {
    ok = false;
    lines.push(`❌ Se rompieron (pasaban siempre, ahora nunca): ${broken.map((r) => r.id).join(", ")}`);
  }
  const fixed = report.results.filter((r) => (baseline.cases[r.id] ?? 0) === 0 && r.passes > 0 && r.id in baseline.cases);
  if (fixed.length) lines.push(`✅ Ahora pasan: ${fixed.map((r) => r.id).join(", ")}`);
  const fresh = report.results.filter((r) => !(r.id in baseline.cases));
  if (fresh.length) lines.push(`Casos nuevos (sin línea base): ${fresh.map((r) => `${r.id} ${r.passes}/${opts.k}`).join(", ")}`);
  if (!opts.partial) {
    const before = Object.values(baseline.cases).filter((p) => p > 0).length;
    const known = report.results.filter((r) => r.id in baseline.cases && r.passes > 0).length;
    lines.push(`Línea base (${baseline.date}): ${before}/${Object.keys(baseline.cases).length}.`);
    if (known < before - TOLERANCE) {
      ok = false;
      lines.push(`❌ Bajó de ${before} a ${known} casos que pasan (se aceptan ${TOLERANCE} menos).`);
    }
  }
  return { ok, lines };
};
