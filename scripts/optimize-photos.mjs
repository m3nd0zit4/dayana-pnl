// Optimize Dayana portrait cutouts (transparent PNGs, 4-10MB each) into
// responsive AVIF + WebP derivatives for the cinematic hero / landing page.
//
//   node scripts/optimize-photos.mjs
//
// Sources:  public/dayana-photos/*.PNG
// Output:   public/dayana-photos/opt/{base}-{width}.{avif,webp}
// Also prints a tiny base64 blur placeholder for each (paste into hero data).

import { readdir, mkdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC_DIR = path.join(__dirname, "..", "public", "dayana-photos");
const OUT_DIR = path.join(SRC_DIR, "opt");

const WIDTHS = [600, 900, 1200];
const AVIF = { quality: 52, effort: 6 }; // alpha preserved automatically
const WEBP = { quality: 74, effort: 6 };

const kb = (bytes) => `${(bytes / 1024).toFixed(0)}kb`;

async function run() {
  await mkdir(OUT_DIR, { recursive: true });
  const files = (await readdir(SRC_DIR)).filter((f) => /\.png$/i.test(f));

  if (files.length === 0) {
    console.log("No PNG sources found in", SRC_DIR);
    return;
  }

  for (const file of files) {
    const srcPath = path.join(SRC_DIR, file);
    const base = file.replace(/\.png$/i, "");
    const input = sharp(srcPath, { failOn: "none" });
    const meta = await input.metadata();
    const srcSize = (await stat(srcPath)).size;

    console.log(
      `\n${file}  ${meta.width}x${meta.height}  ${kb(srcSize)}  alpha=${meta.hasAlpha}`
    );

    for (const w of WIDTHS) {
      if (meta.width && w > meta.width) continue; // never upscale
      const resized = sharp(srcPath, { failOn: "none" }).resize({
        width: w,
        withoutEnlargement: true,
      });

      const avifOut = path.join(OUT_DIR, `${base}-${w}.avif`);
      const webpOut = path.join(OUT_DIR, `${base}-${w}.webp`);

      const aInfo = await resized.clone().avif(AVIF).toFile(avifOut);
      const wInfo = await resized.clone().webp(WEBP).toFile(webpOut);

      console.log(
        `  ${w}w  avif ${kb(aInfo.size)}  webp ${kb(wInfo.size)}`
      );
    }

    // 24px blurred LQIP for the hero placeholder
    const blur = await sharp(srcPath, { failOn: "none" })
      .resize({ width: 24 })
      .webp({ quality: 40 })
      .toBuffer();
    console.log(
      `  blur: data:image/webp;base64,${blur.toString("base64").slice(0, 48)}... (${blur.length}b)`
    );
  }

  console.log("\nDone. Output ->", path.relative(process.cwd(), OUT_DIR));
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
