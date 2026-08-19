/**
 * Siembra la biblioteca de cursos desde `content/curriculum/**`.
 *
 * El currículo es contenido versionado, no filas escritas a mano en el CRM:
 * así el mismo temario que se revisa en pruebas es el que llega a producción,
 * y una corrección de texto es un diff, no un copy-paste.
 *
 * Es idempotente. La clave estable es el slug — `Product.id` para el curso,
 * `(productId, slug)` para módulos y lecciones — así que volver a correrlo
 * actualiza en lugar de duplicar. No borra nada: lo que sobra en la DB se
 * reporta al final para que un humano decida.
 *
 *   bun run db:seed:curriculum            # todos los cursos
 *   bun run db:seed:curriculum niveles-de-conciencia
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { LessonContentType, PrismaClient, ProductKind } from "@prisma/client";

const prisma = new PrismaClient();

const ROOT = join(process.cwd(), "content", "curriculum");

type CourseMeta = {
  title: string;
  description?: string;
  sessionsLabel?: string;
  summary?: string;
  isActive?: boolean;
  sortOrder?: number;
  imageUrl?: string;
};

type ModuleMeta = {
  title: string;
  isPublished?: boolean;
  bodyMd?: string;
};

type LessonFrontmatter = {
  title: string;
  type: LessonContentType;
  description?: string;
  evergreen?: boolean;
  /** Solo informativo en el reporte: qué video hay que grabar para esta lección. */
  video?: string;
};

/** Reglas por defecto del catálogo, si el archivo del quiz no trae `config`. */
const DEFAULT_QUIZ_RULES = { timeLimitMin: 10, maxAttempts: 3, passPercent: 70 };

type ExerciseFile = {
  title?: string;
  description?: string;
  introMd?: string;
  closingMd?: string;
  sections: Array<{
    title?: string;
    bodyMd?: string;
    fields: Array<{
      id: string;
      label: string;
      help?: string;
      type?: "long" | "short" | "choice";
      options?: string[];
      placeholder?: string;
      required?: boolean;
    }>;
  }>;
};

type QuizFile = {
  title?: string;
  /** Reglas del intento; sin ellas se aplican las de lib/lms/quiz.ts. */
  config?: { timeLimitMin?: number; maxAttempts?: number; passPercent?: number };
  questions: Array<{
    id: string;
    prompt: string;
    options: Array<{ id: string; text: string; correct: boolean }>;
  }>;
};

const readJson = <T>(path: string): T =>
  JSON.parse(readFileSync(path, "utf8")) as T;

const dirsIn = (path: string) =>
  readdirSync(path)
    .filter((name) => statSync(join(path, name)).isDirectory())
    .sort();

const filesIn = (path: string) =>
  readdirSync(path)
    .filter((name) => statSync(join(path, name)).isFile())
    .sort();

/**
 * Frontmatter mínimo: `clave: valor` entre dos `---`. Se resuelve a mano en vez
 * de añadir gray-matter — son cuatro claves escalares y el resto del archivo es
 * el cuerpo tal cual.
 */
const parseLesson = (raw: string): { data: LessonFrontmatter; body: string } => {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(raw);
  if (!match) {
    throw new Error("La lección no tiene frontmatter");
  }

  const data: Record<string, string | boolean> = {};
  for (const line of match[1].split(/\r?\n/)) {
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    const sep = line.indexOf(":");
    if (sep === -1) continue;
    const key = line.slice(0, sep).trim();
    let value: string | boolean = line.slice(sep + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (value === "true") value = true;
    if (value === "false") value = false;
    data[key] = value;
  }

  return {
    data: data as unknown as LessonFrontmatter,
    body: match[2].trim(),
  };
};

/**
 * `01-introduccion` + `03-la-hipnosis.md` → `introduccion__la-hipnosis`.
 *
 * El prefijo del módulo no es decorativo: la clave única es `(productId, slug)`
 * y casi todos los módulos tienen un `01-presentacion.md`. Sin prefijo, la
 * presentación de un módulo sobrescribe la del anterior y el curso entero se
 * colapsa a una decena de lecciones. El número inicial solo fija el orden.
 */
const lessonSlug = (moduleSlug: string, fileName: string) => {
  const base = fileName
    .replace(/\.(md|quiz\.json|exercise\.json|json)$/, "")
    .replace(/^\d+[-_]/, "");
  return `${moduleSlug}__${base}`;
};

const report = {
  courses: 0,
  modules: 0,
  lessons: 0,
  pendingPdf: [] as string[],
  pendingVideo: [] as string[],
  orphans: [] as string[],
};

/** Slugs que están en la DB y ya no en el árbol — los que `--prune` borra. */
const orphanModuleSlugs: string[] = [];
const orphanLessonSlugs: string[] = [];

const seedCourse = async (courseId: string) => {
  const courseDir = join(ROOT, courseId);
  const meta = readJson<CourseMeta>(join(courseDir, "curso.json"));

  await prisma.product.upsert({
    where: { id: courseId },
    create: {
      id: courseId,
      kind: ProductKind.COURSE,
      isCourseContent: true,
      title: meta.title,
      sessionsLabel: meta.sessionsLabel ?? "Curso de la biblioteca",
      description: meta.description ?? null,
      imageUrl: meta.imageUrl ?? null,
      isActive: meta.isActive ?? false,
      sortOrder: meta.sortOrder ?? 0,
    },
    update: {
      kind: ProductKind.COURSE,
      isCourseContent: true,
      title: meta.title,
      sessionsLabel: meta.sessionsLabel ?? "Curso de la biblioteca",
      description: meta.description ?? null,
      imageUrl: meta.imageUrl ?? null,
      isActive: meta.isActive ?? false,
      sortOrder: meta.sortOrder ?? 0,
    },
  });
  report.courses += 1;

  const seenModules = new Set<string>();
  const seenLessons = new Set<string>();

  const moduleDirs = dirsIn(courseDir);
  for (const [moduleIndex, moduleDirName] of moduleDirs.entries()) {
    const moduleDir = join(courseDir, moduleDirName);
    const moduleMeta = readJson<ModuleMeta>(join(moduleDir, "modulo.json"));
    const moduleSlug = moduleDirName.replace(/^\d+[-_]/, "");
    seenModules.add(moduleSlug);

    const courseModule = await prisma.courseModule.upsert({
      where: { productId_slug: { productId: courseId, slug: moduleSlug } },
      create: {
        productId: courseId,
        slug: moduleSlug,
        title: moduleMeta.title,
        bodyMd: moduleMeta.bodyMd ?? null,
        isPublished: moduleMeta.isPublished ?? false,
        sortOrder: moduleIndex,
      },
      update: {
        title: moduleMeta.title,
        bodyMd: moduleMeta.bodyMd ?? null,
        isPublished: moduleMeta.isPublished ?? false,
        sortOrder: moduleIndex,
      },
    });
    report.modules += 1;

    const lessonFiles = filesIn(moduleDir).filter(
      (name) =>
        name.endsWith(".md") ||
        name.endsWith(".quiz.json") ||
        name.endsWith(".exercise.json")
    );

    for (const [lessonIndex, fileName] of lessonFiles.entries()) {
      const slug = lessonSlug(moduleSlug, fileName);
      seenLessons.add(slug);
      const filePath = join(moduleDir, fileName);

      let frontmatter: LessonFrontmatter;
      let bodyMd: string | null = null;
      let quizJson: QuizFile | null = null;
      let exerciseJson: ExerciseFile | null = null;

      if (fileName.endsWith(".exercise.json")) {
        const exercise = readJson<ExerciseFile>(filePath);
        exerciseJson = exercise;
        frontmatter = {
          title: exercise.title ?? "Ejercicio",
          type: LessonContentType.EXERCISE,
          description:
            exercise.description ??
            "Responde en el portal — se guarda solo y puedes volver cuando quieras.",
        };
      } else if (fileName.endsWith(".quiz.json")) {
        // El quiz vive en su propio archivo; el título sale del nombre del
        // archivo salvo que traiga uno.
        const quiz = readJson<QuizFile>(filePath);
        quizJson = {
          questions: quiz.questions,
          config: { ...DEFAULT_QUIZ_RULES, ...quiz.config },
        };
        frontmatter = {
          title: quiz.title ?? "Evaluación del módulo",
          type: LessonContentType.QUIZ,
          description:
            "Responde para comprobar lo que te llevas del módulo. Tienes tiempo limitado y varios intentos.",
        };
      } else {
        const parsed = parseLesson(readFileSync(filePath, "utf8"));
        frontmatter = parsed.data;
        bodyMd = parsed.body || null;
      }

      const contentType = frontmatter.type ?? LessonContentType.TEXT;

      const data = {
        title: frontmatter.title,
        description: frontmatter.description ?? null,
        contentType,
        // Solo las lecciones de lectura guardan cuerpo; en un VIDEO o un PDF el
        // texto va en la descripción, que es lo que el reproductor muestra.
        bodyMd: contentType === LessonContentType.TEXT ? bodyMd : null,
        quizJson: quizJson ?? undefined,
        exerciseJson: exerciseJson
          ? { introMd: exerciseJson.introMd, sections: exerciseJson.sections, closingMd: exerciseJson.closingMd }
          : undefined,
        // El catálogo es permanente por definición: nada de la ventana de 30
        // días de las réplicas en vivo.
        evergreen: frontmatter.evergreen ?? true,
        sortOrder: lessonIndex,
        moduleId: courseModule.id,
      };

      const existing = await prisma.liveClassSession.findUnique({
        where: { productId_slug: { productId: courseId, slug } },
        select: { id: true, materialUrl: true, muxPlaybackId: true, recordingUrl: true },
      });

      if (existing) {
        await prisma.liveClassSession.update({ where: { id: existing.id }, data });
      } else {
        await prisma.liveClassSession.create({
          data: { ...data, productId: courseId, slug },
        });
      }
      report.lessons += 1;

      const label = `${courseId} · ${moduleMeta.title} · ${frontmatter.title}`;
      if (contentType === LessonContentType.PDF && !existing?.materialUrl) {
        report.pendingPdf.push(label);
      }
      if (
        contentType === LessonContentType.VIDEO &&
        !existing?.muxPlaybackId &&
        !existing?.recordingUrl
      ) {
        report.pendingVideo.push(
          frontmatter.video ? `${label} — ${frontmatter.video}` : label
        );
      }
    }
  }

  // Por defecto no se borra nada: lo que ya no está en el árbol se reporta para
  // que un humano decida, porque borrar una lección arrastra en cascada el
  // progreso y los comentarios de los miembros. `--prune` lo hace explícito.
  const dbModules = await prisma.courseModule.findMany({
    where: { productId: courseId, slug: { not: null } },
    select: { slug: true, title: true },
  });
  for (const mod of dbModules) {
    if (mod.slug && !seenModules.has(mod.slug)) {
      report.orphans.push(`módulo «${mod.title}» (${courseId}/${mod.slug})`);
      orphanModuleSlugs.push(mod.slug);
    }
  }
  const dbLessons = await prisma.liveClassSession.findMany({
    where: { productId: courseId, slug: { not: null } },
    select: { slug: true, title: true },
  });
  for (const lesson of dbLessons) {
    if (lesson.slug && !seenLessons.has(lesson.slug)) {
      report.orphans.push(`lección «${lesson.title}» (${courseId}/${lesson.slug})`);
      orphanLessonSlugs.push(lesson.slug);
    }
  }
};

/**
 * Borra las filas del seed que ya no están en el árbol. **No** corre por
 * defecto: una lección eliminada arrastra en cascada el progreso y los
 * comentarios de los miembros, así que la decisión es de un humano.
 */
const pruneOrphans = async (courseIds: string[]) => {
  const modules = await prisma.courseModule.deleteMany({
    where: { productId: { in: courseIds }, slug: { in: orphanModuleSlugs } },
  });
  const lessons = await prisma.liveClassSession.deleteMany({
    where: { productId: { in: courseIds }, slug: { in: orphanLessonSlugs } },
  });
  console.log(
    `\nPurgadas ${lessons.count} lecciones y ${modules.count} módulos huérfanos.`
  );
};

const main = async () => {
  const args = process.argv.slice(2);
  const prune = args.includes("--prune");
  const only = args.filter((arg) => !arg.startsWith("-"));
  const courseIds = only.length > 0 ? only : dirsIn(ROOT);

  for (const courseId of courseIds) {
    console.log(`\n▸ ${courseId}`);
    await seedCourse(courseId);
  }

  console.log(
    `\nListo: ${report.courses} cursos, ${report.modules} módulos, ${report.lessons} lecciones.`
  );

  if (report.pendingPdf.length > 0) {
    console.log(`\nPDFs por subir (${report.pendingPdf.length}):`);
    for (const item of report.pendingPdf) console.log(`  · ${item}`);
  }
  if (report.pendingVideo.length > 0) {
    console.log(`\nVideos por grabar/subir (${report.pendingVideo.length}):`);
    for (const item of report.pendingVideo) console.log(`  · ${item}`);
  }
  if (report.orphans.length > 0) {
    console.log(
      `\nEn la DB pero ya no en el currículo (${report.orphans.length}):`
    );
    for (const item of report.orphans) console.log(`  · ${item}`);
    if (prune) await pruneOrphans(courseIds);
    else console.log("\n  Corre con --prune para borrarlas.");
  }
};

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
