// Incrusta las fuentes del recibo PDF como data URLs en un módulo TS.
//
//   node scripts/build-receipt-fonts.mjs
//
// Lee lib/payments/receipt/fonts/Arimo-{Regular,Bold}.ttf y escribe
// lib/payments/receipt/fonts.generated.ts, que se commitea. Van dentro del
// código y no como archivos sueltos porque el recibo se genera desde tres
// sitios (dos rutas y el correo de confirmación) y el file tracing de Vercel no
// sigue un `readFile` con ruta calculada: en producción la fuente faltaría.
//
// Origen de los TTF — Arimo, SIL OFL 1.1 (fonts/OFL.txt), de
// github.com/google/fonts ofl/arimo/Arimo[wght].ttf (commit d7b3b07,
// sha256 e43898b1…e0ca). Es variable y react-pdf no sabe elegir peso dentro de
// una fuente variable, así que se instanció en estático y se recortó a latín
// (español completo, latín extendido, puntuación y €) con fonttools:
//
//   fonttools varLib.instancer "Arimo[wght].ttf" wght=400 --static --update-name-table -o Arimo-400.ttf
//   fonttools varLib.instancer "Arimo[wght].ttf" wght=700 --static --update-name-table -o Arimo-700.ttf
//   fonttools subset Arimo-400.ttf --no-hinting --output-file=Arimo-Regular.ttf \
//     --unicodes="U+0000-024F,U+0259,U+02B0-02FF,U+1E00-1EFF,U+2000-206F,U+20A0-20CF,U+2100-2122,U+2190-2193,U+2212,U+2215,U+FEFF,U+FFFD"
//   (ídem con Arimo-700.ttf → Arimo-Bold.ttf)
//
// Arimo y no otra: tiene las métricas de Helvetica/Arial, así que el recibo
// conserva el mismo ancho de texto y los mismos cortes de línea que tenía con
// la Helvetica integrada del PDF.

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIR = path.join(__dirname, "..", "lib", "payments", "receipt");
const OUT = path.join(DIR, "fonts.generated.ts");

const FONTS = [
  { name: "RECEIPT_FONT_REGULAR", file: "Arimo-Regular.ttf" },
  { name: "RECEIPT_FONT_BOLD", file: "Arimo-Bold.ttf" },
];

const kb = (b) => `${(b / 1024).toFixed(1)}kb`;

// Etiquetas de la tabla de directorio de un sfnt.
const tableTags = (buf) => {
  const numTables = buf.readUInt16BE(4);
  return Array.from({ length: numTables }, (_, i) =>
    buf.toString("latin1", 12 + i * 16, 16 + i * 16)
  );
};

const entries = [];
for (const { name, file } of FONTS) {
  const buf = await readFile(path.join(DIR, "fonts", file));
  if (buf.readUInt32BE(0) !== 0x00010000) {
    throw new Error(`${file}: no es un TrueType (glyf)`);
  }
  if (tableTags(buf).includes("fvar")) {
    throw new Error(`${file}: es variable; react-pdf necesita instancias estáticas`);
  }
  const b64 = buf.toString("base64");
  console.log(`${file}: ${kb(buf.length)} → ${kb(b64.length)} base64`);
  entries.push(`export const ${name} =\n  "data:font/ttf;base64,${b64}";`);
}

const source = `// Generado por scripts/build-receipt-fonts.mjs — no editar a mano.
// Arimo, SIL Open Font License 1.1: ver ./fonts/OFL.txt.

${entries.join("\n\n")}
`;

await writeFile(OUT, source, "utf8");
console.log(`→ ${path.relative(process.cwd(), OUT)} (${kb(source.length)})`);
