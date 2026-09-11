/**
 * Comprueba que cada lección de tipo VIDEO tiene su guion de teleprompter.
 *
 * Los guiones viven en `content/guiones/` con **la misma ruta** que la lección
 * en `content/curriculum/`. Esa correspondencia uno a uno es lo que permite
 * comprobar la cobertura sin mantener una lista aparte: si aparece un vídeo
 * nuevo en el currículo, aquí sale como pendiente al día siguiente.
 *
 *   node scripts/guiones-pendientes.mjs          # resumen + los que faltan
 *   node scripts/guiones-pendientes.mjs --todos  # lista completa
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const CURRICULUM = join(process.cwd(), "content", "curriculum");
const GUIONES = join(process.cwd(), "content", "guiones");

const dirsIn = (path) =>
  readdirSync(path)
    .filter((name) => statSync(join(path, name)).isDirectory())
    .sort();

const parseFrontmatter = (raw) => {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(raw);
  if (!match) return null;
  const data = {};
  for (const line of match[1].split(/\r?\n/)) {
    const sep = line.indexOf(":");
    if (sep === -1) continue;
    data[line.slice(0, sep).trim()] = line.slice(sep + 1).trim();
  }
  return data;
};

/** Palabras habladas por minuto a ritmo de clase, para estimar el guion. */
const WPM = 135;

const rows = [];

for (const courseId of dirsIn(CURRICULUM)) {
  const courseDir = join(CURRICULUM, courseId);
  if (!existsSync(join(courseDir, "curso.json"))) continue;

  for (const moduleDirName of dirsIn(courseDir)) {
    const moduleDir = join(courseDir, moduleDirName);
    for (const fileName of readdirSync(moduleDir).filter((n) => n.endsWith(".md")).sort()) {
      const data = parseFrontmatter(readFileSync(join(moduleDir, fileName), "utf8"));
      if (!data || data.type !== "VIDEO") continue;

      const rel = join(courseId, moduleDirName, fileName);
      const guionPath = join(GUIONES, rel);
      const exists = existsSync(guionPath);
      const words = exists
        ? readFileSync(guionPath, "utf8").split(/\s+/).filter(Boolean).length
        : 0;
      const min = /(\d+)\s*[-–]\s*(\d+)|(\d+)/.exec(data.video ?? "");
      const target = min ? Number(min[1] ?? min[3]) : 0;

      rows.push({ rel, title: data.title, exists, words, target });
    }
  }
}

const faltan = rows.filter((r) => !r.exists);
const hechos = rows.filter((r) => r.exists);
const todos = process.argv.includes("--todos");

if (todos) {
  for (const r of rows) {
    const mark = r.exists ? "✓" : "·";
    const size = r.exists ? `${r.words} palabras` : "pendiente";
    console.log(`${mark} ${r.rel.padEnd(70)} ${size}`);
  }
  console.log("");
}

if (faltan.length) {
  console.log(`Faltan ${faltan.length} guiones:\n`);
  for (const r of faltan) console.log(`  ${r.rel}`);
  console.log("");
}

// Un guion muy corto para su duración objetivo casi siempre es un esbozo que se
// quedó a medias, así que se reporta aparte en vez de contarlo como hecho.
const cortos = hechos.filter((r) => r.target >= 8 && r.words < r.target * WPM * 0.5);
if (cortos.length) {
  console.log(`Sospechosamente cortos para su duración (${cortos.length}):\n`);
  for (const r of cortos) {
    console.log(`  ${r.rel} — ${r.words} palabras para ${r.target} min`);
  }
  console.log("");
}

const totalWords = hechos.reduce((sum, r) => sum + r.words, 0);
console.log(
  `${hechos.length}/${rows.length} guiones escritos · ${totalWords.toLocaleString("es")} palabras.`,
);
