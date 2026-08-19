import { prisma } from "@/lib/db";
import { getCourseOutline } from "./course-content";

/** Con `productId`, solo el progreso de ese curso — el reproductor no tiene por
 *  qué recibir (ni contar) lo completado en el resto de la biblioteca. */
export const getCompletedClassIds = async (
  contactId: string,
  productId?: string
): Promise<Set<string>> => {
  const rows = await prisma.courseClassProgress.findMany({
    where: { contactId, ...(productId ? { class: { productId } } : {}) },
    select: { classId: true },
  });
  return new Set(rows.map((r) => r.classId));
};

export const markClassComplete = async (contactId: string, classId: string) =>
  prisma.courseClassProgress.upsert({
    where: { contactId_classId: { contactId, classId } },
    create: { contactId, classId },
    update: {},
  });

export const markClassIncomplete = async (contactId: string, classId: string) =>
  prisma.courseClassProgress
    .delete({ where: { contactId_classId: { contactId, classId } } })
    .catch(() => null);

export type ModuleCompletion = { done: number; total: number; isComplete: boolean };

/**
 * Pure — a module with zero classes (a reading-only week) is never "complete"
 * via this derivation; that case falls back to the legacy per-module manual
 * toggle (CourseModuleProgress) at the call site.
 */
export const computeModuleCompletion = (
  classIds: string[],
  completedClassIds: Set<string>
): ModuleCompletion => {
  const total = classIds.length;
  const done = classIds.filter((id) => completedClassIds.has(id)).length;
  return { done, total, isComplete: total > 0 && done === total };
};

export type CourseProgress = {
  completedClasses: number;
  totalClasses: number;
  percent: number;
  nextIncompleteClassId: string | null;
};

/**
 * Aggregate progress across every module in course order — feeds the
 * dashboard card's percent/progress-bar and the "resume here" link.
 */
export const getCourseProgress = async (
  productId: string,
  contactId: string
): Promise<CourseProgress> => {
  const [modules, completedClassIds] = await Promise.all([
    getCourseOutline(productId),
    getCompletedClassIds(contactId),
  ]);

  let totalClasses = 0;
  let completedClasses = 0;
  let nextIncompleteClassId: string | null = null;

  for (const mod of modules) {
    for (const cls of mod.classes) {
      totalClasses += 1;
      if (completedClassIds.has(cls.id)) {
        completedClasses += 1;
      } else if (!nextIncompleteClassId) {
        nextIncompleteClassId = cls.id;
      }
    }
  }

  const percent =
    totalClasses > 0 ? Math.round((completedClasses / totalClasses) * 100) : 0;

  return { completedClasses, totalClasses, percent, nextIncompleteClassId };
};
