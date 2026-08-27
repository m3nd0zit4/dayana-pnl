import { ProductKind } from "@prisma/client";

import { prisma } from "@/lib/db";
import { listCourseProducts } from "@/lib/lms/membership";
import { getVisiblePublicPlans } from "@/lib/pricing/public-plans";
import type { Plan } from "@/lib/plans";

/**
 * La cara pública de la biblioteca de cursos.
 *
 * Vive fuera de `lib/lms/*` a propósito: aquello sirve a un visitante que ya
 * pagó y resuelve permisos en cada consulta. Esto lo lee cualquiera, no toca
 * `Enrollment` y nunca decide acceso — sólo describe qué hay dentro para que
 * alguien decida comprar.
 *
 * **Un precio, muchos cursos.** La mensualidad (`coursePlan`) es el único
 * producto vendible; los cursos son contenedores de contenido
 * (`isCourseContent: true`) y `getActiveProducts()` los excluye del catálogo
 * de checkout por construcción. Por eso el precio se pinta una vez, arriba, y
 * no una vez por tarjeta: repetirlo sugeriría que se compran por separado, que
 * es justo lo que no ocurre.
 */

export type CatalogCourse = {
  /** `Product.id` es el slug legible (`fundamentos-pnl`). No hay columna aparte. */
  slug: string;
  title: string;
  description: string | null;
  /** "7 módulos · 45 lecciones", escrito a mano en `curso.json`. */
  sessionsLabel: string;
  imageUrl: string | null;
  moduleCount: number;
  lessonCount: number;
};

export type CourseCatalog = {
  courses: CatalogCourse[];
  /** La mensualidad. `null` si no tiene precio en la moneda del visitante. */
  membership: Plan | null;
  userCountry: string | null;
  isColombia: boolean;
};

/**
 * Sólo se cuentan módulos publicados y sus lecciones.
 *
 * El currículo se siembra con `isPublished` por módulo desde `modulo.json`, y
 * hay cursos a medio grabar: contar los borradores anunciaría lecciones que
 * nadie puede ver todavía.
 */
const countPublished = async (productId: string) => {
  const [moduleCount, lessonCount] = await Promise.all([
    prisma.courseModule.count({ where: { productId, isPublished: true } }),
    prisma.liveClassSession.count({
      where: { productId, module: { isPublished: true } },
    }),
  ]);
  return { moduleCount, lessonCount };
};

export const getCourseCatalog = async (): Promise<CourseCatalog> => {
  const [products, plans] = await Promise.all([
    listCourseProducts().catch(() => []),
    getVisiblePublicPlans(),
  ]);

  // `listCourseProducts()` ya filtra por `isActive`, pero cae a la mensualidad
  // cuando la biblioteca está vacía ("sin cursos de contenido, la mensualidad
  // **es** el curso"). Ese respaldo sirve al portal y no aquí: enseñar la
  // mensualidad como si fuera un curso rompe el argumento de la página.
  const library = products.filter((p) => p.isCourseContent);

  const courses = await Promise.all(
    library.map(async (product) => {
      const { moduleCount, lessonCount } = await countPublished(product.id);
      return {
        slug: product.id,
        title: product.title,
        description: product.description,
        sessionsLabel: product.sessionsLabel,
        imageUrl: product.imageUrl,
        moduleCount,
        lessonCount,
      };
    }),
  );

  return {
    courses,
    membership: plans.coursePlan,
    userCountry: plans.userCountry,
    isColombia: plans.isColombia,
  };
};

export type CourseModuleOutline = {
  id: string;
  title: string;
  bodyMd: string | null;
  lessonCount: number;
};

export type CourseDetail = {
  course: CatalogCourse;
  modules: CourseModuleOutline[];
  membership: Plan | null;
  userCountry: string | null;
  isColombia: boolean;
  /** Cuántos cursos más entran con la misma mensualidad. */
  siblingCount: number;
};

export const getCourseDetail = async (
  slug: string,
): Promise<CourseDetail | null> => {
  const product = await prisma.product.findFirst({
    where: {
      id: slug,
      kind: ProductKind.COURSE,
      isCourseContent: true,
      isActive: true,
    },
  });
  if (!product) return null;

  const [modules, counts, plans, siblings] = await Promise.all([
    prisma.courseModule.findMany({
      where: { productId: product.id, isPublished: true },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      select: {
        id: true,
        title: true,
        bodyMd: true,
        _count: { select: { classes: true } },
      },
    }),
    countPublished(product.id),
    getVisiblePublicPlans(),
    prisma.product.count({
      where: {
        kind: ProductKind.COURSE,
        isCourseContent: true,
        isActive: true,
        NOT: { id: product.id },
      },
    }),
  ]);

  return {
    course: {
      slug: product.id,
      title: product.title,
      description: product.description,
      sessionsLabel: product.sessionsLabel,
      imageUrl: product.imageUrl,
      ...counts,
    },
    modules: modules.map((m) => ({
      id: m.id,
      title: m.title,
      bodyMd: m.bodyMd,
      lessonCount: m._count.classes,
    })),
    membership: plans.coursePlan,
    userCountry: plans.userCountry,
    isColombia: plans.isColombia,
    siblingCount: siblings,
  };
};

/** Slugs de los cursos activos — para `generateStaticParams` y el sitemap. */
export const listCourseSlugs = async (): Promise<string[]> => {
  const rows = await prisma.product.findMany({
    where: {
      kind: ProductKind.COURSE,
      isCourseContent: true,
      isActive: true,
    },
    orderBy: { sortOrder: "asc" },
    select: { id: true },
  });
  return rows.map((r) => r.id);
};
