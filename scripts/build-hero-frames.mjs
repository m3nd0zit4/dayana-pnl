// Build art-directed hero frames for the WebGL fluid-reveal hero.
//
//   node scripts/build-hero-frames.mjs
//
// Two framings so `object-fit:cover` never crops the subject — it only eats the
// generous background margins around her:
//   • desktop  — landscape, Dayana right-of-centre, full figure in a safe band
//   • mobile   — portrait,  Dayana centred, full figure
//
// Each framing exports a warm BASE (color) and a B&W REVEAL, + responsive widths
// and an LQIP. Output: public/hero/

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PHOTOS = path.join(__dirname, "..", "public", "dayana-photos");
const OUT = path.join(__dirname, "..", "public", "hero");

const SRC = "IMG_4007.PNG"; // hand-on-chin — the warm BASE (initial photo).
// Hover gallery — different poses revealed by the liquid.
const GALLERY = ["IMG_4006.PNG", "IMG_4005.PNG", "IMG_4008.PNG", "IMG_4009.PNG"];

// Face anchor per photo, as fractions of the TRIMMED figure bbox:
//   fx,fy = face centre · fh = head height (hairline→chin).
// Every shot is scaled + positioned so its face lands on the same target box
// (frame.TF*), so the liquid swaps poses without the face moving.
const FACE = {
  "IMG_4007.PNG": { fx: 0.5, fy: 0.26, fh: 0.26 }, // hand on chin (base)
  "IMG_4006.PNG": { fx: 0.5, fy: 0.165, fh: 0.17 }, // arms crossed   (lower)
  "IMG_4005.PNG": { fx: 0.56, fy: 0.28, fh: 0.23 }, // finger to temple
  "IMG_4008.PNG": { fx: 0.5, fy: 0.175, fh: 0.18 }, // hands clasped  (lower)
  "IMG_4009.PNG": { fx: 0.5, fy: 0.165, fh: 0.18 }, // smiling        (lower)
};
const kb = (b) => `${(b / 1024).toFixed(0)}kb`;

// framing: subH = subject height as fraction of frame H, bottomGap in px,
// cx = subject centre as fraction of frame W (legacy — used by the mask only).
// TFX/TFY = target face centre, TFH = target face (head) height — all frame
// fractions; the face-anchored placement maps every pose onto this box.
const FRAMES = {
  desktop: { W: 2200, H: 1400, subH: 0.86, bottomGap: 26, cx: 0.5, widths: [2200, 1500], TFX: 0.5, TFY: 0.3, TFH: 0.2 },
  mobile: { W: 1320, H: 1680, subH: 0.9, bottomGap: 22, cx: 0.5, widths: [1320, 900], TFX: 0.5, TFY: 0.32, TFH: 0.22 },
};

function warmBg(W, H) {
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
      <defs>
        <radialGradient id="g" cx="62%" cy="34%" r="86%">
          <stop offset="0%"  stop-color="#f6efe4"/>
          <stop offset="40%" stop-color="#ead9c6"/>
          <stop offset="76%" stop-color="#cf9d7e"/>
          <stop offset="100%" stop-color="#b07659"/>
        </radialGradient>
      </defs>
      <rect width="${W}" height="${H}" fill="url(#g)"/>
    </svg>`
  );
}
function darkBg(W, H) {
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
      <defs>
        <radialGradient id="g" cx="60%" cy="32%" r="90%">
          <stop offset="0%"  stop-color="#2b2724"/>
          <stop offset="45%" stop-color="#16140f"/>
          <stop offset="100%" stop-color="#050403"/>
        </radialGradient>
      </defs>
      <rect width="${W}" height="${H}" fill="url(#g)"/>
    </svg>`
  );
}

async function placeSubject(srcFile, frame, grayscale, o = {}) {
  const subH = o.subH ?? frame.subH;
  const cx = o.cx ?? frame.cx;
  const trimmed = await sharp(path.join(PHOTOS, srcFile), { failOn: "none" }).trim().png().toBuffer();
  const m = await sharp(trimmed).metadata();
  const subjectH = Math.round(frame.H * subH);
  const subjectW = Math.round(subjectH * (m.width / m.height));

  let pipe = sharp(trimmed).resize({ height: subjectH });
  if (grayscale) pipe = pipe.grayscale().linear(1.12, -14);
  const buffer = await pipe.png().toBuffer();

  const left = Math.round(frame.W * cx - subjectW / 2);
  const top = frame.H - subjectH - frame.bottomGap;
  return { buffer, left, top };
}

// Scale + position a photo so its face lands on the frame's target face box.
async function placeByFace(srcFile, frame, grayscale) {
  const a = FACE[srcFile];
  const trimmed = await sharp(path.join(PHOTOS, srcFile), { failOn: "none" }).trim().png().toBuffer();
  const m = await sharp(trimmed).metadata();
  const scale = (frame.TFH * frame.H) / (a.fh * m.height);
  const subW = Math.max(1, Math.round(m.width * scale));
  const subH = Math.max(1, Math.round(m.height * scale));

  let pipe = sharp(trimmed).resize({ width: subW, height: subH });
  if (grayscale) pipe = pipe.grayscale().linear(1.12, -14);
  let buffer = await pipe.png().toBuffer();

  let left = Math.round(frame.TFX * frame.W - a.fx * subW);
  let top = Math.round(frame.TFY * frame.H - a.fy * subH);

  // sharp composite needs non-negative, in-bounds offsets → crop overflow.
  let cl = 0, ct = 0, cw = subW, ch = subH;
  if (left < 0) { cl = -left; cw += left; left = 0; }
  if (top < 0) { ct = -top; ch += top; top = 0; }
  if (left + cw > frame.W) cw = frame.W - left;
  if (top + ch > frame.H) ch = frame.H - top;
  if (cl || ct || cw !== subW || ch !== subH) {
    buffer = await sharp(buffer)
      .extract({ left: cl, top: ct, width: Math.max(1, cw), height: Math.max(1, ch) })
      .png()
      .toBuffer();
  }
  return { buffer, left, top };
}

async function renderComposite(bg, sub) {
  return sharp(bg).composite([{ input: sub.buffer, left: sub.left, top: sub.top }]).png().toBuffer();
}

async function exportAll(srcBuffer, baseName, width, formats) {
  const out = [];
  for (const f of formats) {
    const file = path.join(OUT, `${baseName}.${f.ext}`);
    const info = await sharp(srcBuffer).resize({ width })[f.ext === "jpg" ? "jpeg" : f.ext](f.opts).toFile(file);
    out.push(`${f.ext} ${kb(info.size)}`);
  }
  return out.join("  ");
}

async function run() {
  await mkdir(OUT, { recursive: true });

  for (const [name, frame] of Object.entries(FRAMES)) {
    // BASE (warm)
    const baseSub = await placeByFace(SRC, frame, false);
    const baseFull = await renderComposite(warmBg(frame.W, frame.H), baseSub);
    const [wMax, wMin] = frame.widths;
    console.log(
      `hero-${name}@${wMax} `,
      await exportAll(baseFull, `hero-${name}-${wMax}`, wMax, [
        { ext: "avif", opts: { quality: 60, effort: 6 } },
        { ext: "webp", opts: { quality: 80, effort: 6 } },
      ])
    );
    console.log(
      `hero-${name}@${wMin} `,
      await exportAll(baseFull, `hero-${name}`, wMin, [
        { ext: "avif", opts: { quality: 58, effort: 6 } },
        { ext: "webp", opts: { quality: 78, effort: 6 } },
        { ext: "jpg", opts: { quality: 82, mozjpeg: true } },
      ])
    );

    // REVEAL gallery (B&W) — different poses, all face-anchored to the base.
    for (let i = 0; i < GALLERY.length; i++) {
      const revSub = await placeByFace(GALLERY[i], frame, true);
      const revFull = await renderComposite(darkBg(frame.W, frame.H), revSub);
      console.log(
        `hero-${name}-rev-${i + 1} `,
        await exportAll(revFull, `hero-${name}-rev-${i + 1}`, wMin, [
          { ext: "webp", opts: { quality: 76, effort: 6 } },
        ])
      );
    }

    // LQIP
    const blur = await sharp(baseFull).resize({ width: 22 }).webp({ quality: 40 }).toBuffer();
    await writeFile(path.join(OUT, `.lqip-${name}.txt`), `data:image/webp;base64,${blur.toString("base64")}`);
  }

  // Masthead mask frame — Dayana centred + filling, so the DB letters never
  // fall on empty background. Warm (revealed bg) + B&W (through-letter fill).
  const maskFrame = { W: 1600, H: 1200, subH: 0.98, bottomGap: 18, cx: 0.5 };
  const mWarm = await renderComposite(
    warmBg(maskFrame.W, maskFrame.H),
    await placeSubject(SRC, maskFrame, false)
  );
  const mBw = await renderComposite(
    darkBg(maskFrame.W, maskFrame.H),
    await placeSubject(SRC, maskFrame, true)
  );
  console.log(
    "hero-mask      ",
    await exportAll(mWarm, "hero-mask", 1600, [
      { ext: "avif", opts: { quality: 60, effort: 6 } },
      { ext: "webp", opts: { quality: 80, effort: 6 } },
    ])
  );
  console.log(
    "hero-mask-rev  ",
    await exportAll(mBw, "hero-mask-rev", 1600, [
      { ext: "webp", opts: { quality: 78, effort: 6 } },
    ])
  );

  console.log("\nDone -> public/hero/");
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
