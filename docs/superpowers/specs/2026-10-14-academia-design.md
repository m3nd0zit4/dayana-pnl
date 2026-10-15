# Academia — course restructure, audio/PDF lessons, images and the `/academia` URL

Date: 2026-10-14 · Branch: `feat/academia` · Status: awaiting owner review

## 1. What the owner asked for

- Remove the exams and cut the text-based activities.
- More media per module: one, two or three video classes, plus other formats such
  as a recorded guided meditation (audio) or reading material (PDF).
- Tell whether the teleprompter scripts are ready and how to start recording.
- Generate images for the courses.
- Move the course area to the URL `/academia`.
- Bug: «Empezar» and opening a module did not start at the first entry of the
  syllabus.

## 2. Decisions (owner, 2026-10-14)

| Topic | Decision |
|---|---|
| URL | `/academia`: the member portal `/miembros/*` becomes `/academia/*` and the public catalog `/cursos/*` becomes `/academia/cursos/*`. Old URLs redirect permanently. |
| Module template | 3–4 videos + 1 guided audio + 1 PDF + at most one short optional exercise. No exams. No text lessons. |
| Audio | New lesson type `AUDIO`, uploaded to Mux like a video, played with an audio player and the module image. |
| PDFs | Generated from the course files at request time, served only to members. No Vercel Blob (the store has been suspended since about 2026-09-30). |
| Images | 8 course covers (1200×675) + 1 illustration per module. Shared style, generated locally for free, shipped as static files. |
| Liderazgo | Stays off. Not restructured in this pass. |
| Scripts | The 42 recovered scripts are back in the repo (done, `c9996bf`). |

## 3. Starting point (verified 2026-10-14)

- The curriculum is versioned in `content/curriculum/`, with 8 course folders.
  The 7 active courses have 7 modules each (49 modules). Liderazgo has module
  folders but no lessons.
- Totals today:

  | VIDEO | TEXT | Quiz | Exercise |
  |---|---|---|---|
  | 151 | 162 (~79,000 words) | 49 | 41 |

- Per module today: Presentación (video), 1–3 theory texts, «Material y
  referencias» (text), «Guía de trabajo» (text), «Clase en video», a «caso/práctica»
  video, an exercise and a quiz. Hipnosis also has 5 guided audios stored as VIDEO.
- Neither `neondb_dev` nor prod has the curriculum seeded. Dev was wiped on
  2026-10-02 and rebuilt with products only. During the bug fix, Fundamentos
  was seeded into dev.
- Teleprompter scripts: 42/151 exist (Fundamentos + Niveles), 24 of them under
  75% of their target length. Hipnosis, Creencias, Lenguaje, Emociones and
  Pareja have none.
- Course covers (`/api/admin/products/cover`) and lesson PDFs
  (`/api/admin/lms/classes/[id]/material`, `/api/miembros/classes/[id]/material`)
  depend on Vercel Blob, which is suspended. Mux works.

## 4. Module template

Every active module ends up as:

| # | Item | Type | Length | Source |
|---|---|---|---|---|
| 1 | Presentación | VIDEO | 3–4 min | existing |
| 2 | Clase 1 · <topic> | VIDEO | 10–15 min | the existing «Clase en video» (script reused as is) |
| 3 | Clase 2 · <topic> | VIDEO | 8–12 min | **new**, built from the module's theory texts; only when they hold enough material not covered by Clase 1 |
| 4 | Caso / Práctica | VIDEO | 8–15 min | the existing 05b/06b video |
| 5 | 🎧 Audio guiado | AUDIO | 7–15 min | **new** (Hipnosis: its 5 existing guided audios move from VIDEO to AUDIO) |
| 6 | 📄 Material del módulo | PDF | 3–8 pages | **new**, generated from the theory texts + «Material y referencias» + «Guía de trabajo» |
| 7 | ✍️ Ejercicio (opcional) | EXERCISE | ≤ 4 fields | existing, trimmed |

What disappears from the curriculum:
- **All 49 quizzes.** The `QUIZ` type and its code stay, so a quiz can still be
  created by hand in the admin.
- **All 162 TEXT lessons.** Their content moves into the PDF (as reading
  material) and into the scripts of Clase 2 and the audio.

The module's own `bodyMd` (the short «Introducción» row) stays. It is the first
entry of each module, where «Empezar» and opening a module now land.

Result: about 196 videos and 49 audios across the 7 courses, versus 151 videos today.

### File conventions in `content/curriculum/<curso>/<NN-modulo>/`

- `01-presentacion.md`, `02-clase-1-<slug>.md`, `03-clase-2-<slug>.md`,
  `04-practica-<slug>.md` — `type: VIDEO`, with the existing `video:` brief line.
- `05-audio-<slug>.md` — `type: AUDIO`. Its `video:` line becomes `audio:`, the
  length and what the guided audio covers.
- `06-material.md` — `type: PDF`. The body is the full PDF content in Markdown:
  headings, paragraphs, lists, simple tables, a «Para leer más» list with real
  books (author, title, year).
- `07-ejercicio.exercise.json` — unchanged format, at most 4 fields.
- Renaming files changes lesson slugs, and new slugs mean new rows. That is fine
  because no member has progress on curriculum lessons in any database. Dev is
  cleaned with `--prune` (see §5.3).

Scripts follow the lessons one to one: `content/guiones/<same path>.md`. A script
for a renamed lesson is moved to the new path (`git mv`).

## 5. Platform changes

### 5.1 `AUDIO` lesson type

- Prisma: add `AUDIO` to `LessonContentType`. Additive migration; apply only with
  `bunx prisma migrate deploy`.
- Admin `/admin/curso`: an AUDIO lesson uploads through the same Mux direct
  upload as VIDEO. Mux accepts audio files and creates an audio-only asset. The
  label and the accepted MIME types change to `audio/*`.
- Portal: `MuxPlayer` with `audio` (no video frame), the module image as artwork,
  🎧 «Audio» in the outline. Completion works like video, including the
  "no automatic completion without media" rule from `29a5aac`.
- `isRecordingVisible` treats AUDIO like an evergreen VIDEO: curriculum lessons
  never expire.

### 5.2 PDFs generated from content

- Seed: a `PDF` lesson stores its Markdown body in `bodyMd` (today only TEXT does).
- `GET /api/miembros/classes/[id]/material`: unchanged when `materialUrl` is set
  (uploaded file, Blob). When it is empty and `bodyMd` exists, the route renders
  the PDF with `@react-pdf/renderer`, already used for receipts and reusing their
  fonts. Layout: course + module header, the body (H2/H3, paragraphs, bold/italic,
  lists, simple tables) and a footer «Dayana Beltrán PNL · <curso>». Same member
  and published checks as today. Cached (`Cache-Control: private`, ETag from
  `updatedAt`).
- Portal: a PDF lesson shows its content inline (the same Markdown renderer as
  TEXT) with a «Descargar PDF» button. On a phone, reading in the page is enough.

### 5.3 Seed (`scripts/seed-curriculum.ts`)

- Accepts `type: AUDIO` and stores `bodyMd` for PDF.
- `module.json` accepts `imageUrl`. New column `CourseModule.imageUrl String?`,
  additive migration.
- `--prune`: deletes curriculum-managed modules and lessons (`slug` not null) whose
  file no longer exists. Without the flag it keeps today's behaviour (report only).
  It **refuses to run when the database name is not `neondb_dev`** unless
  `--allow-prod` is passed; prod has no curriculum yet anyway.
- The report lists AUDIO lessons without media next to VIDEO lessons.

### 5.4 Scripts tooling

- `scripts/guiones-pendientes.mjs` also covers AUDIO lessons.
- `content:teleprompter` exports AUDIO scripts too.

## 6. URL `/academia`

- Move `app/miembros/**` to `app/academia/**` and `app/cursos/**` to
  `app/academia/cursos/**`, with `git mv` to keep history.
- `proxy.ts`: the member area is `/academia/*` except the public catalog
  `/academia/cursos/*`. Update the public auth paths, the profile gate and the
  legacy sign-in paths (`/miembros/acceso` keeps redirecting).
- `next.config.ts` permanent redirects (308):

  | From | To |
  |---|---|
  | `/miembros` | `/academia` |
  | `/miembros/:path*` | `/academia/:path*` |
  | `/cursos` | `/academia/cursos` |
  | `/cursos/:path*` | `/academia/cursos/:path*` |

  Links already sent in emails keep working.
- Every internal link, email template and notification variable
  (`lib/notifications/member-emails.ts`, `variables.ts`), `lib/inngest/functions.ts`,
  `robots.ts`, the sitemap, Footer, AccountMenu and the role routing in `/acceso`.
  Nav labels that name the area say «Academia».
- `/api/miembros/*` stays as is. It is not user-visible, and moving it would
  touch auth and webhook paths for no gain.
- The e2e specs that hit `/miembros` move to `/academia`.

## 7. Images

- Style: calm, warm and symbolic, in the brand palette from `DESIGN.md`. No text
  in the image, no identifiable faces, no stock-photo look. One consistent family
  across all courses; each course has its own accent motif.
- Tool: local models (skill `ia-local`, Ideogram), so it costs no credits.
- Steps:
  1. Three style options for one cover (Niveles).
  2. The owner picks one.
  3. Batch: 7 covers + 49 module images. Liderazgo's cover is optional.
- Files: `public/academia/<curso>/portada.webp` (1200×675) and
  `public/academia/<curso>/<NN-modulo>.webp` (1200×675, also used as audio
  artwork), wired through `curso.json` `imageUrl` and `module.json` `imageUrl`.
  They are decorative, so public static files are fine.
- Where they show: course card and course page (existing `imageUrl`), the module
  header in the player, the AUDIO player artwork.

## 8. Recording

- The 42 scripts are in `content/guiones/`. `npm run content:teleprompter -- --out <dir>`
  writes plain `.txt` files for a teleprompter app. A copy is already in
  `E:\Dev\Dayana\guiones-para-grabar\`.
- **Niveles de Conciencia can be recorded now.** Its 21 videos map onto the
  template as Presentación, Clase 1 and Práctica. Clase 2 and the audio come later.
- Before shooting, review the Drive live-class recordings; a trimmed recording
  can replace a re-shoot.
- Uploading works today because it goes through Mux. Blob is not needed for any
  of this design.
- `HOJA-DE-RODAJE.md` is rewritten at the end from the new structure: per course
  the videos and audios, script status and recording sessions.

## 9. Work packages and agents

| WP | What | Who | Depends on |
|---|---|---|---|
| 0 | Recover scripts + Start bug fix | done | — |
| 1 | URL `/academia` + redirects | 1 agent | 0 |
| 2 | Platform: AUDIO, `CourseModule.imageUrl`, PDF rendering, seed `--prune`, player, tooling | 1 agent | 1 (same files) |
| 3 | Content restructure per course (§4) | 1 agent per course, 7 in parallel | file conventions only; runs alongside 1–2 |
| 4 | Scripts: Clase 2, audios, the 109 missing, expand the ones flagged short (skip Niveles if its recording already started) | agents per course, parallel | 3 for that course |
| 5 | Images: 3 samples → owner picks → batch | 1 agent / main session | owner's pick |
| 6 | Integration: merge, seed `neondb_dev` with `--prune`, browser QA as the test member, code review, rewrite HOJA-DE-RODAJE | main session | 1–5 |

Each agent works in its own branch or worktree off `feat/academia`, commits there,
never pushes or merges, and its worktree is removed after integration.

## 10. Safety and release

- Tests and seeding only against `neondb_dev`. Never `migrate dev`/`reset`/`db push`
  or a real database as the shadow database; migrations only with
  `bunx prisma migrate deploy`.
- Production is a separate step. It needs:
  1. explicit owner confirmation in the chat;
  2. a Neon backup first;
  3. the release itself: fast-forward `main`, then `bun run db:seed:curriculum`
     against prod (first load, nothing to prune).
- The Blob suspension stays the owner's to fix in Vercel. This design no longer
  depends on it.

## 11. Testing

- Unit tests:
  - course sequence (done);
  - the Markdown → PDF renderer, which must not throw on real module files;
  - seed parsing of AUDIO/PDF;
  - `--prune` refusing a non-dev DB;
  - redirects (`next.config` entries).
- `npm run typecheck`, lint, `bun test ./lib`, the existing e2e specs moved to
  `/academia`.
- Browser QA on dev as `miembro.prueba@example.com`:
  - Start lands on the first entry;
  - a module opens at its first entry;
  - a video placeholder;
  - an audio lesson with media (one test upload to Mux dev);
  - PDF inline + download;
  - an exercise;
  - old `/miembros/...` and `/cursos/...` links redirect;
  - dark mode.
