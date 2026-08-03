/**
 * One-off: seed 4 additional sample modules (5 total with the existing one)
 * with realistic PNL content, for local UI/UX QA of the course player.
 * Uso: bun --env-file=.env.local run scripts/seed-sample-course-modules.ts
 */
import { prisma } from "../lib/db";

const MODULES = [
  {
    title: "Módulo 2 · Anclajes y Estados de Recursos",
    bodyMd:
      "## Anclajes\n\nAprende a instalar y disparar anclas para acceder a estados de recursos cuando los necesites.",
    classes: [
      {
        title: "Qué es un ancla y cómo se instala",
        description: "Fundamentos del anclaje: timing, intensidad y replicación del estímulo.",
        hasRecording: true,
      },
      {
        title: "Práctica guiada: ancla de confianza",
        description: "Sesión práctica para instalar un ancla de confianza personal.",
        hasRecording: false,
      },
    ],
  },
  {
    title: "Módulo 3 · Submodalidades y Cambio de Creencias",
    bodyMd:
      "## Submodalidades\n\nLas cualidades finas de nuestras representaciones internas — y cómo ajustarlas para cambiar cómo nos sentimos.",
    classes: [
      {
        title: "Mapa no es territorio: submodalidades visuales",
        description: "Brillo, distancia, tamaño — cómo cada submodalidad cambia el impacto emocional de un recuerdo.",
        hasRecording: true,
      },
      {
        title: "Swish pattern para creencias limitantes",
        description: "Técnica de sustitución rápida para interrumpir patrones automáticos.",
        hasRecording: false,
      },
    ],
  },
  {
    title: "Módulo 4 · Rapport y Comunicación Efectiva",
    bodyMd:
      "## Rapport\n\nCómo generar sintonía genuina con otra persona — la base de toda comunicación efectiva.",
    classes: [
      {
        title: "Espejo y calibración",
        description: "Igualar postura, tono y ritmo para generar sintonía inconsciente.",
        hasRecording: true,
      },
      {
        title: "Escucha activa y metamodelo del lenguaje",
        description: "Preguntas precisas para recuperar la información que el lenguaje generaliza u omite.",
        hasRecording: false,
      },
    ],
  },
  {
    title: "Módulo 5 · Metaprogramas y Patrones de Lenguaje",
    bodyMd:
      "## Metaprogramas\n\nLos filtros mentales que determinan cómo cada persona procesa la realidad — y cómo reconocerlos en una conversación.",
    classes: [
      {
        title: "Metaprogramas: cómo filtramos la realidad",
        description: "Identifica los patrones de motivación y decisión más comunes.",
        hasRecording: true,
      },
      {
        title: "Milton model: lenguaje hipnótico conversacional",
        description: "Patrones lingüísticos ericksonianos para comunicación persuasiva y ética.",
        hasRecording: false,
      },
    ],
  },
];

async function main() {
  const product = await prisma.product.findFirst({ where: { kind: "COURSE" } });
  if (!product) throw new Error("No course product found — run db:seed first");

  const lastModule = await prisma.courseModule.findFirst({
    where: { productId: product.id },
    orderBy: { sortOrder: "desc" },
    select: { sortOrder: true },
  });
  let nextSortOrder = (lastModule?.sortOrder ?? -1) + 1;

  for (const modDef of MODULES) {
    let mod = await prisma.courseModule.findFirst({
      where: { productId: product.id, title: modDef.title },
    });
    if (!mod) {
      mod = await prisma.courseModule.create({
        data: {
          productId: product.id,
          title: modDef.title,
          bodyMd: modDef.bodyMd,
          isPublished: true,
          sortOrder: nextSortOrder++,
        },
      });
      console.log("Created module:", mod.title);
    }

    let classSortOrder = 0;
    for (const clsDef of modDef.classes) {
      const existing = await prisma.liveClassSession.findFirst({
        where: { moduleId: mod.id, title: clsDef.title },
      });
      if (existing) {
        classSortOrder++;
        continue;
      }
      await prisma.liveClassSession.create({
        data: {
          productId: product.id,
          moduleId: mod.id,
          title: clsDef.title,
          description: clsDef.description,
          scheduledAt: clsDef.hasRecording
            ? new Date(Date.now() - 10 * 24 * 60 * 60 * 1000)
            : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
          meetUrl: clsDef.hasRecording ? null : "https://meet.google.com/abc-defg-hij",
          recordingUrl: clsDef.hasRecording
            ? "https://drive.google.com/file/d/1a2b3c4d5e6f7g8h9i0j/view"
            : null,
          recordingPostedAt: clsDef.hasRecording ? new Date() : null,
          sortOrder: classSortOrder++,
        },
      });
    }
  }

  console.log("Done — 5 modules total for product", product.id);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
