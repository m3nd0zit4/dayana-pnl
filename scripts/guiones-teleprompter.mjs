/**
 * Exporta los guiones de `content/guiones/` a texto plano para una app de
 * teleprompter.
 *
 * Las apps de teleprompter leen texto, no Markdown: un `**` o un `---` en
 * pantalla distrae justo cuando hay que mirar a cámara. Aquí se quitan las
 * marcas y se dejan las acotaciones entre corchetes (`[PAUSA]`, `[A CÁMARA]`),
 * que son instrucciones para quien graba y conviene verlas al pasar.
 *
 * Un archivo por vídeo, en una carpeta plana por curso y con el número de
 * módulo delante, para que en la tablet salgan en el orden de rodaje.
 *
 *   node scripts/guiones-teleprompter.mjs --out <carpeta>            # todos
 *   node scripts/guiones-teleprompter.mjs --out <carpeta> <curso>    # uno
 */
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const GUIONES = join(process.cwd(), "content", "guiones");

const args = process.argv.slice(2);
const outIdx = args.indexOf("--out");
if (outIdx === -1 || !args[outIdx + 1]) {
  console.error("Uso: node scripts/guiones-teleprompter.mjs --out <carpeta> [curso]");
  process.exit(1);
}
const OUT = args[outIdx + 1];
const soloCurso = args.filter((_, i) => i !== outIdx && i !== outIdx + 1)[0];

const dirsIn = (path) =>
  readdirSync(path)
    .filter((name) => statSync(join(path, name)).isDirectory())
    .sort();

const aTexto = (raw) =>
  raw
    .replace(/\r\n/g, "\n")
    .replace(/^---$/gm, "")
    .replace(/^#+\s*/gm, "")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/(^|[^*])\*([^*\n]+)\*/g, "$1$2")
    .replace(/\n{3,}/g, "\n\n")
    .trim() + "\n";

let total = 0;
for (const curso of dirsIn(GUIONES)) {
  if (soloCurso && curso !== soloCurso) continue;
  const destino = join(OUT, curso);
  mkdirSync(destino, { recursive: true });
  for (const modulo of dirsIn(join(GUIONES, curso))) {
    const numero = /^(\d+)/.exec(modulo)?.[1] ?? "00";
    for (const archivo of readdirSync(join(GUIONES, curso, modulo)).filter((n) => n.endsWith(".md")).sort()) {
      const raw = readFileSync(join(GUIONES, curso, modulo, archivo), "utf8");
      const nombre = `M${numero}-${archivo.replace(/\.md$/, ".txt")}`;
      writeFileSync(join(destino, nombre), aTexto(raw));
      total += 1;
    }
  }
}

console.log(`${total} guiones exportados a ${OUT}`);
