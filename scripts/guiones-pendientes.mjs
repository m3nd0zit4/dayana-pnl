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

/** Palabras por minuto de lectura en teleprompter, sin contar las pausas. */
const WPM = 125;
/** Segundos que se lleva cada marca. Una pausa marcada se respeta al grabar. */
const SEG_PAUSA = 2.5;
const SEG_PAUSA_LARGA = 6;

/**
 * Minutos que dura un guion al grabarlo.
 *
 * Contar palabras a secas no vale: la mitad del archivo son acotaciones que no
 * se dicen —rótulos, indicaciones de cámara, la cabecera— y las marcas de pausa
 * sí ocupan tiempo aunque no tengan palabras. Restar unas y sumar las otras da
 * una estimación que se parece a lo que marca el cronómetro.
 */
const estimar = (raw) => {
  // Los guiones con acotaciones separan la cabecera con `---`; los limpios no,
  // y ahí el título ya se descarta abajo con el resto de líneas `#`.
  const partes = raw.split(/^---$/m);
  const cuerpo = partes.length > 1 ? partes.slice(1).join("---") : raw;
  const pausasLargas = (cuerpo.match(/\[PAUSA (LARGA|REAL)[^\]]*\]/g) ?? []).length;
  const pausas = (cuerpo.match(/\[PAUSA\]/g) ?? []).length;
  const hablado = cuerpo
    .replace(/\[[^\]]*\]/g, " ") // acotaciones
    .replace(/^[|#>].*$/gm, " ") // tablas, títulos y citas de las fichas
    .split(/\s+/)
    .filter(Boolean).length;
  const minutos =
    hablado / WPM + (pausas * SEG_PAUSA + pausasLargas * SEG_PAUSA_LARGA) / 60;
  return { hablado, minutos };
};

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
      const raw = exists ? readFileSync(guionPath, "utf8") : "";
      const { hablado, minutos } = exists ? estimar(raw) : { hablado: 0, minutos: 0 };
      // Los vídeos con invitado no llevan guion palabra por palabra: llevan un
      // guion de conducción con las preguntas y los avisos, porque escribirle
      // los diálogos a una conversación real es justo lo que la estropea.
      const conduccion = /^## (Guion de conducción|Conversación)/m.test(raw);
      const min = /(\d+)\s*[-–]\s*(\d+)|(\d+)/.exec(data.video ?? "");
      const target = min ? Number(min[1] ?? min[3]) : 0;

      rows.push({ rel, title: data.title, exists, hablado, minutos, conduccion, target });
    }
  }
}

const faltan = rows.filter((r) => !r.exists);
const hechos = rows.filter((r) => r.exists);
const todos = process.argv.includes("--todos");

const duracion = (r) =>
  r.conduccion ? "conducción" : `~${Math.round(r.minutos)} min`;

if (todos) {
  for (const r of rows) {
    const mark = r.exists ? "✓" : "·";
    const size = r.exists ? duracion(r) : "pendiente";
    console.log(`${mark} ${r.rel.padEnd(70)} ${size}`);
  }
  console.log("");
}

if (faltan.length) {
  console.log(`Faltan ${faltan.length} guiones:\n`);
  for (const r of faltan) console.log(`  ${r.rel}`);
  console.log("");
}

// Un guion que rinde mucho menos que su duración objetivo casi siempre es un
// esbozo que se quedó corto de material, así que se reporta aparte en vez de
// contarlo como hecho. Los de conducción no se miden: su duración la pone la
// conversación, no el texto.
const cortos = hechos.filter(
  (r) => !r.conduccion && r.target >= 8 && r.minutos < r.target * 0.75,
);
if (cortos.length) {
  console.log(`Cortos para su duración objetivo (${cortos.length}):\n`);
  for (const r of cortos) {
    console.log(`  ${r.rel} — ~${Math.round(r.minutos)} min, objetivo ${r.target}`);
  }
  console.log("");
}

const totalHablado = hechos.reduce((sum, r) => sum + r.hablado, 0);
const totalMin = hechos.reduce((sum, r) => sum + r.minutos, 0);
console.log(
  `${hechos.length}/${rows.length} guiones · ${totalHablado.toLocaleString("es")} palabras habladas · ~${Math.round(totalMin)} min de metraje.`,
);
