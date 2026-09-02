import { ProductKind } from "@prisma/client";

import { prisma } from "@/lib/db";
import type { PortalViewer } from "@/lib/auth/portal-viewer";
import {
  getEnrolledCourses,
  isNeverPaid,
  listCourseProducts,
} from "@/lib/lms/membership";
import { getVisiblePublicPlans } from "@/lib/pricing/public-plans";
import { getPublicPlans } from "@/lib/plans-from-db";
import { isPlanVisibleForRegion } from "@/lib/pricing/plan-visibility";
import type { Plan } from "@/lib/plans";

/**
 * La cara pública de la biblioteca de cursos.
 *
 * Vive fuera de `lib/lms/*` a propósito: aquello sirve al reproductor y
 * resuelve permisos en cada consulta. Esto describe qué hay dentro para que
 * alguien decida comprar, y tiene que hacerlo igual de bien para quien no ha
 * entrado nunca que para quien ya tiene acceso.
 *
 * **Hay dos formas de comprar, y la página enseña las dos.** La membresía abre
 * la biblioteca entera mientras esté al día; un curso marcado
 * `sellsStandalone` se compra suelto y no caduca. Por eso el precio aparece
 * arriba —la membresía— y también por tarjeta cuando ese curso concreto está
 * publicado a la venta. Antes ninguna tarjeta llevaba cifra, y era correcto:
 * no existía nada que comprar por separado.
 *
 * **Pasar un `viewer` no cambia el catálogo, sólo lo anota.** Sin sesión la
 * página se sirve idéntica; con ella cada tarjeta gana su `access`. Quién
 * puede ver qué lo sigue decidiendo `getEnrolledCourses`, nunca esta capa.
 */

/** Lo que esta persona ya tiene de este curso. `null` = visitante anónimo. */
export type CourseAccess = {
  hasAccess: boolean;
  /** Ni mes pagado ni compra suelta. Distingue «activar» de «renovar». */
  neverPaid: boolean;
  percent: number;
  completedLessons: number;
  /** Siguiente lección sin completar, para el botón «Continuar». */
  nextClassId: string | null;
};

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
  /**
   * Precio de la compra suelta de ESTE curso, si está publicado a la venta y
   * tiene precio en la moneda del visitante. `null` en el caso normal, en el
   * que el curso sólo se abre con la membresía.
   */
  plan: Plan | null;
  access: CourseAccess | null;
};

export type CourseCatalog = {
  courses: CatalogCourse[];
  /** La mensualidad. `null` si no tiene precio en la moneda del visitante. */
  membership: Plan | null;
  /** La anualidad, si está activa y tiene precio aquí. */
  annual: Plan | null;
  /** ¿Hay al menos un curso a la venta suelta? Decide el discurso de la página. */
  hasStandaloneSales: boolean;
  userCountry: string | null;
  isColombia: boolean;
};

/**
 * Los dos periodos de la membresía, separados del resto del catálogo.
 *
 * `getVisiblePublicPlans()` devuelve `coursePlan` en singular porque durante
 * mucho tiempo sólo hubo uno. En vez de cambiar esa forma —la usan la home, el
 * portal, `llms.txt` y la API pública— la anualidad se resuelve aquí, que es
 * el único sitio que necesita las dos.
 */
const splitMembership = (plans: { allPlans: Plan[] }, coursePlan: Plan | null) => {
  const annual =
    plans.allPlans.find(
      (p) => p.kind === "course" && !p.libraryCourse && (p.membershipMonths ?? 1) > 1,
    ) ?? null;
  return { membership: coursePlan, annual };
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

type CourseProgressRow = {
  percent: number;
  completedLessons: number;
  nextClassId: string | null;
};

/**
 * Progreso de varios cursos a la vez.
 *
 * `getCourseProgress` existe y es correcto, pero resuelve un curso por
 * llamada y relee las lecciones completadas de la persona en cada una: con
 * ocho tarjetas son dieciséis consultas para responder algo que cabe en dos.
 * La rejilla se pinta entera de una vez, así que se pide entera de una vez.
 */
const progressForCourses = async (
  contactId: string,
  productIds: string[],
): Promise<Map<string, CourseProgressRow>> => {
  const result = new Map<string, CourseProgressRow>();
  if (productIds.length === 0) return result;

  const [classes, completedRows] = await Promise.all([
    prisma.liveClassSession.findMany({
      where: { productId: { in: productIds }, module: { isPublished: true } },
      // El mismo orden que ve el reproductor, para que «la siguiente sin
      // completar» sea de verdad la siguiente y no una cualquiera.
      orderBy: [{ module: { sortOrder: "asc" } }, { sortOrder: "asc" }],
      select: { id: true, productId: true },
    }),
    prisma.courseClassProgress.findMany({
      where: { contactId, class: { productId: { in: productIds } } },
      select: { classId: true },
    }),
  ]);

  const completed = new Set(completedRows.map((r) => r.classId));

  for (const productId of productIds) {
    result.set(productId, { percent: 0, completedLessons: 0, nextClassId: null });
  }

  const totals = new Map<string, number>();
  for (const cls of classes) {
    totals.set(cls.productId, (totals.get(cls.productId) ?? 0) + 1);
    const row = result.get(cls.productId);
    if (!row) continue;
    if (completed.has(cls.id)) {
      row.completedLessons += 1;
    } else if (row.nextClassId === null) {
      row.nextClassId = cls.id;
    }
  }

  for (const [productId, row] of result) {
    const total = totals.get(productId) ?? 0;
    row.percent = total === 0 ? 0 : Math.round((row.completedLessons / total) * 100);
  }

  return result;
};

/** El plan de venta suelta de un curso, ya filtrado por región. */
const standalonePlanFor = (
  slug: string,
  allPlans: Plan[],
  isColombia: boolean,
): Plan | null => {
  const plan = allPlans.find((p) => p.id === slug && p.libraryCourse);
  if (!plan) return null;
  // Sin precio explícito en la moneda de la región no se enseña cifra: la web
  // nunca deriva un COP a ojo, y un botón sin precio cobrable acaba en error.
  return isPlanVisibleForRegion(plan, isColombia) ? plan : null;
};

export const getCourseCatalog = async (
  viewer?: PortalViewer | null,
): Promise<CourseCatalog> => {
  const [products, plans, all] = await Promise.all([
    listCourseProducts().catch(() => []),
    getVisiblePublicPlans(),
    getPublicPlans().catch(() => ({ allPlans: [] as Plan[] })),
  ]);

  // `listCourseProducts()` ya filtra por `isActive`, pero cae a la mensualidad
  // cuando la biblioteca está vacía ("sin cursos de contenido, la mensualidad
  // **es** el curso"). Ese respaldo sirve al portal y no aquí: enseñar la
  // mensualidad como si fuera un curso rompe el argumento de la página.
  const library = products.filter((p) => p.isCourseContent);
  const productIds = library.map((p) => p.id);

  const enrolled = viewer
    ? await getEnrolledCourses(viewer.contact.id, { isOwner: viewer.isOwner }).catch(
        () => [],
      )
    : [];
  const membershipByProduct = new Map(enrolled.map((e) => [e.product.id, e.membership]));

  const progress = viewer
    ? await progressForCourses(viewer.contact.id, productIds).catch(
        () => new Map<string, CourseProgressRow>(),
      )
    : new Map<string, CourseProgressRow>();

  const courses = await Promise.all(
    library.map(async (product) => {
      const { moduleCount, lessonCount } = await countPublished(product.id);
      const info = membershipByProduct.get(product.id);
      const p = progress.get(product.id);
      return {
        slug: product.id,
        title: product.title,
        description: product.description,
        sessionsLabel: product.sessionsLabel,
        imageUrl: product.imageUrl,
        moduleCount,
        lessonCount,
        plan: standalonePlanFor(product.id, all.allPlans, plans.isColombia),
        access: viewer
          ? {
              hasAccess: info?.isCurrent ?? false,
              neverPaid: info ? isNeverPaid(info) : true,
              percent: p?.percent ?? 0,
              completedLessons: p?.completedLessons ?? 0,
              nextClassId: p?.nextClassId ?? null,
            }
          : null,
      };
    }),
  );

  const { membership, annual } = splitMembership(all, plans.coursePlan);

  // Aquí se devolvía además un resumen del visitante para una tira de estado
  // bajo el hero. Se quitó: el avatar de la cabecera ya dice quién eres en
  // todas las páginas, y dos sitios contando lo mismo acaban contándolo
  // distinto. Lo que sigue viviendo por visitante es el `access` de cada
  // tarjeta, que es información del curso y no de la identidad.
  return {
    courses,
    membership,
    annual: annual && isPlanVisibleForRegion(annual, plans.isColombia) ? annual : null,
    hasStandaloneSales: courses.some((c) => c.plan != null),
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
  annual: Plan | null;
  userCountry: string | null;
  isColombia: boolean;
  /** Cuántos cursos más entran con la misma membresía. */
  siblingCount: number;
};

export const getCourseDetail = async (
  slug: string,
  viewer?: PortalViewer | null,
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

  const [modules, counts, plans, all, siblings] = await Promise.all([
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
    getPublicPlans().catch(() => ({ allPlans: [] as Plan[] })),
    prisma.product.count({
      where: {
        kind: ProductKind.COURSE,
        isCourseContent: true,
        isActive: true,
        NOT: { id: product.id },
      },
    }),
  ]);

  const enrolled = viewer
    ? await getEnrolledCourses(viewer.contact.id, { isOwner: viewer.isOwner }).catch(
        () => [],
      )
    : [];
  const info = enrolled.find((e) => e.product.id === product.id)?.membership;
  const progress = viewer
    ? (await progressForCourses(viewer.contact.id, [product.id]).catch(
        () => new Map<string, CourseProgressRow>(),
      )).get(product.id)
    : undefined;

  return {
    course: {
      slug: product.id,
      title: product.title,
      description: product.description,
      sessionsLabel: product.sessionsLabel,
      imageUrl: product.imageUrl,
      ...counts,
      plan: standalonePlanFor(product.id, all.allPlans, plans.isColombia),
      access: viewer
        ? {
            hasAccess: info?.isCurrent ?? false,
            neverPaid: info ? isNeverPaid(info) : true,
            percent: progress?.percent ?? 0,
            completedLessons: progress?.completedLessons ?? 0,
            nextClassId: progress?.nextClassId ?? null,
          }
        : null,
    },
    modules: modules.map((m) => ({
      id: m.id,
      title: m.title,
      bodyMd: m.bodyMd,
      lessonCount: m._count.classes,
    })),
    membership: plans.coursePlan,
    annual: (() => {
      const { annual } = splitMembership(all, plans.coursePlan);
      return annual && isPlanVisibleForRegion(annual, plans.isColombia)
        ? annual
        : null;
    })(),
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
