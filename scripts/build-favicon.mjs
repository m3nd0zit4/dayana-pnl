// Build the DB-mark favicons from a 512px master render.
//
//   node scripts/build-favicon.mjs <master.png>
//
// The master is rendered font-accurately by screenshotting public/_fav.html
// (Space Grotesk 700, "DB." cream + terracotta dot on ink) via headless Chrome.
// This script only resizes it + assembles favicon.ico + favicon.svg.

import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, "..", "public");
const master = process.argv[2];
if (!master) {
  console.error("usage: node scripts/build-favicon.mjs <master.png>");
  process.exit(1);
}

const kb = (b) => `${(b / 1024).toFixed(1)}kb`;

async function png(size) {
  return sharp(master).resize(size, size, { fit: "cover" }).png().toBuffer();
}

// Maskable icons get padded into the safe zone (the OS may crop a circle),
// so the big DB never touches the cropped edge.
async function maskablePng(size) {
  const inner = Math.round(size * 0.82);
  const mark = await sharp(master).resize(inner, inner, { fit: "cover" }).png().toBuffer();
  return sharp({
    create: { width: size, height: size, channels: 4, background: "#0a0a0a" },
  })
    .composite([{ input: mark, gravity: "center" }])
    .png()
    .toBuffer();
}

// Minimal ICO container with embedded PNG entries (Vista+).
function buildIco(entries) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type = icon
  header.writeUInt16LE(entries.length, 4);
  const dir = Buffer.alloc(16 * entries.length);
  let offset = 6 + dir.length;
  entries.forEach((e, i) => {
    const b = dir.subarray(i * 16);
    b.writeUInt8(e.size >= 256 ? 0 : e.size, 0); // width
    b.writeUInt8(e.size >= 256 ? 0 : e.size, 1); // height
    b.writeUInt8(0, 2); // palette
    b.writeUInt8(0, 3); // reserved
    b.writeUInt16LE(1, 4); // planes
    b.writeUInt16LE(32, 6); // bpp
    b.writeUInt32LE(e.buf.length, 8); // bytes
    b.writeUInt32LE(offset, 12); // offset
    offset += e.buf.length;
  });
  return Buffer.concat([header, dir, ...entries.map((e) => e.buf)]);
}

const FAVICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" fill="#0a0a0a"/>
  <text x="252" y="348" text-anchor="middle" font-family="'Space Grotesk','Arial Black',Arial,sans-serif" font-weight="700" font-size="270" letter-spacing="-14" fill="#ece3d4">DB<tspan fill="#c0654a">.</tspan></text>
</svg>
`;

async function run() {
  const jobs = [
    ["favicon-96x96.png", 96, png],
    ["apple-touch-icon.png", 180, png],
    ["web-app-manifest-192x192.png", 192, maskablePng],
    ["web-app-manifest-512x512.png", 512, maskablePng],
  ];
  for (const [name, size, make] of jobs) {
    const buf = await make(size);
    await writeFile(path.join(OUT, name), buf);
    console.log(name.padEnd(30), kb(buf.length));
  }

  const ico = buildIco([
    { size: 16, buf: await png(16) },
    { size: 32, buf: await png(32) },
    { size: 48, buf: await png(48) },
  ]);
  await writeFile(path.join(OUT, "favicon.ico"), ico);
  console.log("favicon.ico".padEnd(30), kb(ico.length));

  await writeFile(path.join(OUT, "favicon.svg"), FAVICON_SVG);
  console.log("favicon.svg".padEnd(30), kb(Buffer.byteLength(FAVICON_SVG)));

  console.log("\nDone -> public/");
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
