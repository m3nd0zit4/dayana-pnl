import { EnrollmentStatus, PaymentStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getCourseProduct } from "./membership";

/** Resolves the single active course; LMS admin routes operate on it implicitly. */
export const requireCourseProduct = async () => {
  const product = await getCourseProduct();
  if (!product) {
    throw new Error("NO_COURSE_PRODUCT");
  }
  return product;
};

export type CourseMemberRow = {
  enrollmentId: string;
  status: EnrollmentStatus;
  paidUntil: string | null;
  amountMinor: number | null;
  currency: string | null;
  lastPaymentAt: string | null;
  paymentsCount: number;
  hasAccount: boolean;
  contact: {
    id: string;
    firstName: string;
    lastName: string | null;
    email: string | null;
    phoneE164: string;
  };
};

export const listCourseMembersAdmin = async (
  productId: string
): Promise<CourseMemberRow[]> => {
  const enrollments = await prisma.enrollment.findMany({
    where: {
      productId,
      status: { not: EnrollmentStatus.LEAD },
    },
    orderBy: [{ paidUntil: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
    include: {
      contact: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
          phoneE164: true,
          memberAccount: { select: { id: true } },
        },
      },
      payments: {
        where: { status: PaymentStatus.APPROVED },
        orderBy: { paidAt: "desc" },
        take: 1,
        select: { paidAt: true, createdAt: true },
      },
      _count: {
        select: {
          payments: { where: { status: PaymentStatus.APPROVED } },
        },
      },
    },
  });

  return enrollments.map((en) => ({
    enrollmentId: en.id,
    status: en.status,
    paidUntil: en.paidUntil?.toISOString() ?? null,
    amountMinor: en.amountMinor,
    currency: en.currency,
    lastPaymentAt:
      (en.payments[0]?.paidAt ?? en.payments[0]?.createdAt)?.toISOString() ??
      null,
    paymentsCount: en._count.payments,
    hasAccount: Boolean(en.contact.memberAccount),
    contact: {
      id: en.contact.id,
      firstName: en.contact.firstName,
      lastName: en.contact.lastName,
      email: en.contact.email,
      phoneE164: en.contact.phoneE164,
    },
  }));
};

export const listCourseModulesAdmin = async (productId: string) => {
  const modules = await prisma.courseModule.findMany({
    where: { productId },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    include: {
      _count: { select: { classes: true } },
      classes: {
        select: { _count: { select: { comments: { where: { hiddenAt: null } } } } },
      },
    },
  });

  // Prisma can't count a two-hop relation (module -> classes -> comments) in
  // one _count, so sum the per-class counts fetched above instead of a
  // second query per module. classCount is flattened here too (not left as
  // _count.classes) so every consumer — initial SSR render and the client's
  // reload() alike — gets the same shape from this one function.
  return modules.map(({ classes, _count, ...mod }) => ({
    ...mod,
    classCount: _count.classes,
    commentCount: classes.reduce((sum, c) => sum + c._count.comments, 0),
  }));
};

export const getCourseModuleAdmin = async (id: string) =>
  prisma.courseModule.findUnique({
    where: { id },
    include: {
      classes: {
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
        include: {
          _count: { select: { comments: { where: { hiddenAt: null } } } },
        },
      },
    },
  });

export const createCourseModule = async (input: {
  productId: string;
  title: string;
  bodyMd?: string | null;
  isPublished?: boolean;
}) => {
  const last = await prisma.courseModule.findFirst({
    where: { productId: input.productId },
    orderBy: { sortOrder: "desc" },
    select: { sortOrder: true },
  });
  return prisma.courseModule.create({
    data: {
      productId: input.productId,
      title: input.title,
      bodyMd: input.bodyMd ?? null,
      isPublished: input.isPublished ?? false,
      sortOrder: (last?.sortOrder ?? -1) + 1,
    },
  });
};

export const updateCourseModule = async (
  id: string,
  data: { title?: string; bodyMd?: string | null; isPublished?: boolean }
) => prisma.courseModule.update({ where: { id }, data });

export const deleteCourseModule = async (id: string) =>
  prisma.courseModule.delete({ where: { id } });

export const reorderCourseModules = async (
  productId: string,
  orderedIds: string[]
) => {
  await prisma.$transaction(
    orderedIds.map((id, index) =>
      prisma.courseModule.updateMany({
        where: { id, productId },
        data: { sortOrder: index },
      })
    )
  );
};

export const listLiveClassesAdmin = async (productId: string) =>
  prisma.liveClassSession.findMany({
    where: { productId },
    orderBy: [{ scheduledAt: { sort: "desc", nulls: "first" } }],
  });

export const listClassesForModule = async (moduleId: string) =>
  prisma.liveClassSession.findMany({
    where: { moduleId },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    include: {
      _count: { select: { comments: { where: { hiddenAt: null } } } },
    },
  });

/** Classes not yet assigned to any week — the admin's cleanup tray. */
export const listUnassignedClasses = async (productId: string) =>
  prisma.liveClassSession.findMany({
    where: { productId, moduleId: null },
    orderBy: [{ scheduledAt: { sort: "desc", nulls: "first" } }],
  });

export const createLiveClass = async (input: {
  productId: string;
  moduleId?: string | null;
  title: string;
  description?: string | null;
  scheduledAt?: Date | null;
  meetUrl?: string | null;
  recordingUrl?: string | null;
}) => {
  let sortOrder = 0;
  if (input.moduleId) {
    const last = await prisma.liveClassSession.findFirst({
      where: { moduleId: input.moduleId },
      orderBy: { sortOrder: "desc" },
      select: { sortOrder: true },
    });
    sortOrder = (last?.sortOrder ?? -1) + 1;
  }

  return prisma.liveClassSession.create({
    data: {
      productId: input.productId,
      moduleId: input.moduleId ?? null,
      title: input.title,
      description: input.description ?? null,
      scheduledAt: input.scheduledAt ?? null,
      meetUrl: input.meetUrl ?? null,
      recordingUrl: input.recordingUrl ?? null,
      recordingPostedAt: input.recordingUrl ? new Date() : null,
      sortOrder,
    },
  });
};

export const updateLiveClass = async (
  id: string,
  input: {
    title?: string;
    description?: string | null;
    scheduledAt?: Date | null;
    meetUrl?: string | null;
    recordingUrl?: string | null;
  }
) => {
  const current = await prisma.liveClassSession.findUnique({ where: { id } });
  if (!current) return null;

  const data: Record<string, unknown> = { ...input };

  if ("recordingUrl" in input) {
    const next = input.recordingUrl ?? null;
    if (next && next !== current.recordingUrl) {
      // New recording: restart the 30-day visibility window.
      data.recordingPostedAt = new Date();
      data.recordingHiddenAt = null;
    } else if (!next) {
      data.recordingPostedAt = null;
      data.recordingHiddenAt = null;
    }
  }

  return prisma.liveClassSession.update({ where: { id }, data });
};

export const deleteLiveClass = async (id: string) =>
  prisma.liveClassSession.delete({ where: { id } });

export const reorderCourseClasses = async (
  moduleId: string,
  orderedIds: string[]
) => {
  await prisma.$transaction(
    orderedIds.map((id, index) =>
      prisma.liveClassSession.updateMany({
        where: { id, moduleId },
        data: { sortOrder: index },
      })
    )
  );
};

/** Moves a class into a week (or back to unassigned with `moduleId: null`).
 *  Appends to the end of the target module's order. */
export const assignClassToModule = async (
  classId: string,
  moduleId: string | null
) => {
  let sortOrder = 0;
  if (moduleId) {
    const last = await prisma.liveClassSession.findFirst({
      where: { moduleId },
      orderBy: { sortOrder: "desc" },
      select: { sortOrder: true },
    });
    sortOrder = (last?.sortOrder ?? -1) + 1;
  }
  return prisma.liveClassSession.update({
    where: { id: classId },
    data: { moduleId, sortOrder },
  });
};
