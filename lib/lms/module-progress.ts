import { prisma } from "@/lib/db";

/** Con `productId`, solo los módulos de ese curso — igual que su hermano de
 *  clases, para no mandar al navegador el progreso de toda la biblioteca. */
export const getCompletedModuleIds = async (
  contactId: string,
  productId?: string
): Promise<Set<string>> => {
  const rows = await prisma.courseModuleProgress.findMany({
    where: { contactId, ...(productId ? { module: { productId } } : {}) },
    select: { moduleId: true },
  });
  return new Set(rows.map((r) => r.moduleId));
};

export const markModuleComplete = async (contactId: string, moduleId: string) =>
  prisma.courseModuleProgress.upsert({
    where: { contactId_moduleId: { contactId, moduleId } },
    create: { contactId, moduleId },
    update: {},
  });

export const markModuleIncomplete = async (contactId: string, moduleId: string) =>
  prisma.courseModuleProgress
    .delete({ where: { contactId_moduleId: { contactId, moduleId } } })
    .catch(() => null);
