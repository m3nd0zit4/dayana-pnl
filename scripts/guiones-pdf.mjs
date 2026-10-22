/**
 * Exporta los guiones de `content/guiones/` a PDF para mandarlos por WhatsApp.
 *
 * Un PDF por guion y otro por módulo con los cinco seguidos. Por WhatsApp el
 * archivo llega suelto, sin la carpeta, así que el nombre lo dice todo: curso,
 * módulo, orden dentro del módulo y título («Fundamentos M1.2 · Clase 1 · Qué
 * es la PNL.pdf»). El completo del módulo es el `.0`, para que salga primero.
 *
 * La página es A5 con letra grande: en el celular el PDF se ajusta al ancho y
 * un A4 a 11 pt queda ilegible sin hacer zoom.
 *
 * El PDF lo imprime Chrome (o Edge) en modo headless; no hace falta instalar
 * nada. Si no lo encuentra, pásale la ruta con --browser.
 *
 *   node scripts/guiones-pdf.mjs --out <carpeta>            # todos
 *   node scripts/guiones-pdf.mjs --out <carpeta> <curso>    # uno
 */
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const RAIZ = process.cwd();
const CURRICULUM = join(RAIZ, "content", "curriculum");
const GUIONES = join(RAIZ, "content", "guiones");
const FUENTES = join(RAIZ, "public", "fonts");

const args = process.argv.slice(2);
const opcion = (nombre) => {
  const i = args.indexOf(nombre);
  return i === -1 ? undefined : args[i + 1];
};
const OUT = opcion("--out");
if (!OUT) {
  console.error("Uso: node scripts/guiones-pdf.mjs --out <carpeta> [--browser <ruta>] [curso]");
  process.exit(1);
}
const soloCurso = args.filter((a, i) => !a.startsWith("--") && !args[i - 1]?.startsWith("--"))[0];

const NAVEGADORES = [
  opcion("--browser"),
  process.env.CHROME_PATH,
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
];
const NAVEGADOR = NAVEGADORES.find((ruta) => ruta && existsSync(ruta));
if (!NAVEGADOR) {
  console.error("No encontré Chrome ni Edge. Pásale la ruta con --browser.");
  process.exit(1);
}

/** Nombre corto para los archivos: el título entero no cabe en WhatsApp. */
const CORTOS = {
  "fundamentos-pnl": "Fundamentos",
  "niveles-de-conciencia": "8 Niveles",
  "hipnosis-y-pnl": "Hipnosis",
  "creencias-limitantes": "Creencias",
  "poder-del-lenguaje": "Lenguaje",
  "emociones-y-anclajes": "Emociones",
  "pnl-en-pareja": "Pareja",
};

const dirsIn = (path) =>
  readdirSync(path)
    .filter((name) => statSync(join(path, name)).isDirectory())
    .sort();

const parseFrontmatter = (raw) => {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(raw);
  const data = {};
  for (const line of match?.[1].split(/\r?\n/) ?? []) {
    const sep = line.indexOf(":");
    if (sep !== -1) data[line.slice(0, sep).trim()] = line.slice(sep + 1).trim();
  }
  return data;
};

/** Windows no admite estos caracteres en un nombre de archivo. */
const nombreArchivo = (texto) =>
  texto.replace(/[¿?]/g, "").replace(/:/g, " -").replace(/[\\/*"<>|]/g, "").replace(/\s+/g, " ").trim();

const escapar = (texto) =>
  texto.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const enLinea = (texto) =>
  escapar(texto)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>");

/**
 * El cuerpo del guion a HTML. Los guiones son párrafos y, en los vídeos con
 * invitado, un par de `##` y una lista de preguntas; no hace falta más.
 * El título y la línea de curso · módulo · minutos se quitan porque la
 * cabecera del PDF ya los pone con los datos del currículo.
 */
const cuerpoHtml = (raw) =>
  raw
    .replace(/\r\n/g, "\n")
    .split(/\n{2,}/)
    .map((bloque) => bloque.trim())
    .filter((bloque) => bloque && bloque !== "---")
    .filter((bloque) => !/^# /.test(bloque) && !/· Módulo \d+ ·.*min\**$/.test(bloque))
    .map((bloque) => {
      if (bloque.startsWith("## ")) return `<h2>${enLinea(bloque.slice(3))}</h2>`;
      const lineas = bloque.split("\n");
      if (lineas.every((l) => /^\d+\.\s/.test(l)))
        return `<ol>${lineas.map((l) => `<li>${enLinea(l.replace(/^\d+\.\s+/, ""))}</li>`).join("")}</ol>`;
      if (lineas.every((l) => /^[-*]\s/.test(l)))
        return `<ul>${lineas.map((l) => `<li>${enLinea(l.slice(2))}</li>`).join("")}</ul>`;
      return `<p>${enLinea(lineas.join(" "))}</p>`;
    })
    .join("\n");

const fuente = (archivo) =>
  `data:font/woff2;base64,${readFileSync(join(FUENTES, archivo)).toString("base64")}`;

const CSS = `
@font-face { font-family: "Lausanne"; font-weight: 300; src: url(${fuente("Lausanne-300.woff2")}) format("woff2"); }
@font-face { font-family: "Lausanne"; font-weight: 500; src: url(${fuente("Lausanne-500.woff2")}) format("woff2"); }
@page {
  size: A5;
  margin: 15mm 13mm 17mm;
  @bottom-left { font: 300 7.5pt "Lausanne", Georgia, serif; color: #6f655c; }
  @bottom-right { content: counter(page) " / " counter(pages); font: 300 7.5pt "Lausanne", Georgia, serif; color: #6f655c; }
}
html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body {
  margin: 0;
  font-family: "Lausanne", Georgia, serif;
  font-weight: 300;
  font-size: 13.5pt;
  line-height: 1.58;
  color: #141210;
  hyphens: none;
}
.pieza + .pieza, .portada + .pieza { break-before: page; }
.antetitulo {
  font-weight: 500; font-size: 8pt; letter-spacing: 0.14em; text-transform: uppercase;
  color: #5c4a3a;
}
.modulo { font-size: 10pt; color: #6f655c; margin-top: 2pt; }
h1 { font-weight: 500; font-size: 21pt; line-height: 1.15; margin: 10pt 0 6pt; letter-spacing: -0.01em; }
.datos {
  font-size: 9.5pt; color: #6f655c;
  padding-bottom: 10pt; margin-bottom: 16pt; border-bottom: 1.5pt solid #edc3b1;
}
p { margin: 0 0 0.8em; orphans: 3; widows: 3; }
h2 {
  font-weight: 500; font-size: 9pt; letter-spacing: 0.14em; text-transform: uppercase;
  color: #5c4a3a; margin: 20pt 0 8pt; break-after: avoid;
}
ol, ul { margin: 0 0 0.8em; padding-left: 1.4em; }
li { margin-bottom: 0.55em; padding-left: 0.2em; }
li::marker { color: #5c4a3a; font-weight: 500; }
.portada { padding-top: 22mm; }
.portada h1 { font-size: 26pt; margin: 14pt 0 4pt; }
.portada .curso { font-size: 12pt; color: #5c4a3a; font-weight: 500; }
.indice { list-style: none; padding: 0; margin: 26pt 0 0; border-top: 1.5pt solid #edc3b1; }
.indice li {
  display: flex; justify-content: space-between; gap: 12pt;
  padding: 8pt 0; margin: 0; border-bottom: 0.5pt solid #e4dccf; font-size: 11pt;
}
.indice .min { color: #6f655c; white-space: nowrap; }
.firma { margin-top: 30pt; font-size: 9pt; color: #6f655c; }
`;

/** El pie lleva qué es la hoja, por si se imprime y se mezclan los papeles. */
const documento = (pie, contenido, { portada = false } = {}) => `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><title>Guion</title>
<style>${CSS}
@page { @bottom-left { content: "${pie.replace(/["\\]/g, "")}"; } }
${portada ? "@page :first { @bottom-left { content: none; } @bottom-right { content: none; } }" : ""}
</style>
</head><body>${contenido}</body></html>`;

const piezaHtml = ({ curso, modulo, pieza }) => `
<section class="pieza">
  <div class="antetitulo">${escapar(curso.titulo)}</div>
  <div class="modulo">Módulo ${modulo.numero} · ${escapar(modulo.titulo)}</div>
  <h1>${escapar(pieza.titulo)}</h1>
  <div class="datos">${pieza.audio ? "Audio guiado" : "Video"}${pieza.minutos ? ` · ${pieza.minutos} min` : ""}</div>
  ${cuerpoHtml(pieza.raw)}
</section>`;

const portadaHtml = ({ curso, modulo }) => `
<section class="portada">
  <div class="antetitulo">Guiones · Dayana Beltrán PNL</div>
  <div class="curso" style="margin-top:14pt">${escapar(curso.titulo)}</div>
  <h1>Módulo ${modulo.numero}<br>${escapar(modulo.titulo)}</h1>
  <ol class="indice">${modulo.piezas
    .map((p) => `<li><span>${escapar(p.titulo)}</span><span class="min">${p.minutos ? `${p.minutos} min` : ""}</span></li>`)
    .join("")}</ol>
  <p class="firma">Cinco guiones para grabar, en orden: presentación, dos clases, práctica y audio guiado.</p>
</section>`;

// Recolectar ---------------------------------------------------------------

const cursos = [];
for (const id of dirsIn(GUIONES)) {
  if (soloCurso && id !== soloCurso) continue;
  const cursoJson = join(CURRICULUM, id, "curso.json");
  if (!existsSync(cursoJson)) continue;
  const titulo = JSON.parse(readFileSync(cursoJson, "utf8")).title;
  const curso = { id, titulo, corto: CORTOS[id] ?? titulo, modulos: [] };
  for (const dir of dirsIn(join(GUIONES, id))) {
    const numero = Number(/^(\d+)/.exec(dir)?.[1] ?? 0);
    const moduloJson = join(CURRICULUM, id, dir, "modulo.json");
    const tituloModulo = existsSync(moduloJson) ? JSON.parse(readFileSync(moduloJson, "utf8")).title : dir;
    const piezas = readdirSync(join(GUIONES, id, dir))
      .filter((n) => n.endsWith(".md"))
      .sort()
      .map((archivo, i) => {
        const raw = readFileSync(join(GUIONES, id, dir, archivo), "utf8");
        const leccion = join(CURRICULUM, id, dir, archivo);
        const datos = existsSync(leccion) ? parseFrontmatter(readFileSync(leccion, "utf8")) : {};
        const brief = datos.audio ?? datos.video ?? "";
        return {
          orden: i + 1,
          titulo: datos.title ?? /^# (.+)$/m.exec(raw)?.[1] ?? archivo,
          audio: datos.type === "AUDIO",
          minutos: /^(\d+\s*[-–]\s*\d+|\d+)\s*min/.exec(brief)?.[1]?.replace(/\s/g, "").replace("-", "–"),
          raw,
        };
      });
    curso.modulos.push({ dir, numero, titulo: tituloModulo, piezas });
  }
  cursos.push(curso);
}

// Imprimir -----------------------------------------------------------------

const TEMP = mkdtempSync(join(tmpdir(), "guiones-pdf-"));
const trabajos = [];
for (const curso of cursos) {
  for (const modulo of curso.modulos) {
    const carpeta = join(OUT, nombreArchivo(curso.titulo), nombreArchivo(`M${modulo.numero} · ${modulo.titulo}`));
    mkdirSync(carpeta, { recursive: true });
    const prefijo = `${curso.corto} M${modulo.numero}`;
    trabajos.push({
      html: documento(
        `${curso.corto} · Módulo ${modulo.numero}`,
        portadaHtml({ curso, modulo }) + modulo.piezas.map((pieza) => piezaHtml({ curso, modulo, pieza })).join(""),
        { portada: true },
      ),
      pdf: join(carpeta, nombreArchivo(`${prefijo}.0 · Módulo completo · ${modulo.titulo}.pdf`)),
    });
    for (const pieza of modulo.piezas) {
      trabajos.push({
        html: documento(`${prefijo}.${pieza.orden} · ${pieza.titulo}`, piezaHtml({ curso, modulo, pieza })),
        pdf: join(carpeta, nombreArchivo(`${prefijo}.${pieza.orden} · ${pieza.titulo}.pdf`)),
      });
    }
  }
}

const imprimir = (html, pdf, perfil) =>
  new Promise((resolve, reject) => {
    execFile(
      NAVEGADOR,
      [
        "--headless",
        "--disable-gpu",
        "--no-first-run",
        "--no-default-browser-check",
        `--user-data-dir=${perfil}`,
        "--no-pdf-header-footer",
        "--virtual-time-budget=4000",
        `--print-to-pdf=${pdf}`,
        pathToFileURL(html).href,
      ],
      { timeout: 60_000 },
      (error) => (error && !existsSync(pdf) ? reject(error) : resolve()),
    );
  });

// Varias instancias a la vez, cada una con su perfil: Chrome no deja abrir dos
// veces el mismo.
const SIMULTANEOS = 4;
let siguiente = 0;
let hechos = 0;
await Promise.all(
  Array.from({ length: SIMULTANEOS }, async (_, n) => {
    const perfil = join(TEMP, `perfil-${n}`);
    while (siguiente < trabajos.length) {
      const i = siguiente++;
      const html = join(TEMP, `${i}.html`);
      writeFileSync(html, trabajos[i].html);
      await imprimir(html, trabajos[i].pdf, perfil);
      hechos += 1;
      if (hechos % 25 === 0) console.log(`  ${hechos}/${trabajos.length}`);
    }
  }),
);
rmSync(TEMP, { recursive: true, force: true });

console.log(`${hechos} PDF en ${OUT}`);
