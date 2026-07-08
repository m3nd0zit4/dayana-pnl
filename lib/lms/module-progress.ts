import { prisma } from "@/lib/db";

export const getCompletedModuleIds = async (
  contactId: string
): Promise<Set<string>> => {
  const rows = await prisma.courseModuleProgress.findMany({
    where: { contactId },
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
