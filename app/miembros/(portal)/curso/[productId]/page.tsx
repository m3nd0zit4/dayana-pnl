import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { ProductKind } from "@prisma/client";
import { prisma } from "@/lib/db";
import { BRAND } from "@/lib/contact";
import { getMemberSession } from "@/lib/auth/member-session";
import { getEnrolledCourses } from "@/lib/lms/membership";
import { getCourseOutline } from "@/lib/lms/course-content";
import { getCompletedClassIds, getCourseProgress } from "@/lib/lms/class-progress";
import { getCompletedModuleIds } from "@/lib/lms/module-progress";
import CoursePlayer from "@/app/components/miembros/CoursePlayer";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: `Curso — ${BRAND.name}`,
  robots: { index: false, follow: false },
};

type PageProps = {
  params: Promise<{ productId: string }>;
  searchParams: Promise<{ c?: string }>;
};

const Page = async ({ params, searchParams }: PageProps) => {
  const { productId } = await params;
  const { c: selectedFromUrl } = await searchParams;

  const member = await getMemberSession();
  if (!member) redirect("/acceso");

  const product = await prisma.product.findUnique({ where: { id: productId } });
  if (!product || product.kind !== ProductKind.COURSE) notFound();

  const enrolledCourses = await getEnrolledCourses(member.contact.id);
  const enrolled = enrolledCourses.find((c) => c.product.id === productId);
  const isCurrent = enrolled?.membership.isCurrent ?? false;
  const neverPaid = !enrolled || enrolled.membership.paidUntil == null;

  const [modules, completedClassIds, completedModuleIds, progress] = await Promise.all([
    getCourseOutline(productId),
    getCompletedClassIds(member.contact.id),
    getCompletedModuleIds(member.contact.id),
    getCourseProgress(productId, member.contact.id),
  ]);

  const selectedClassId =
    selectedFromUrl ?? progress.nextIncompleteClassId ?? modules[0]?.classes[0]?.id ?? null;

  return (
    <CoursePlayer
      productId={productId}
      courseTitle={product.title}
      modules={modules.map((m) => ({
        id: m.id,
        title: m.title,
        bodyMd: m.bodyMd,
        classes: m.classes.map((cls) => ({
          id: cls.id,
          title: cls.title,
          description: cls.description,
          scheduledAt: cls.scheduledAt ? cls.scheduledAt.toISOString() : null,
          meetUrl: cls.meetUrl,
          recordingUrl: cls.recordingUrl,
          recordingPostedAt: cls.recordingPostedAt
            ? cls.recordingPostedAt.toISOString()
            : null,
          recordingHiddenAt: cls.recordingHiddenAt
            ? cls.recordingHiddenAt.toISOString()
            : null,
        })),
      }))}
      completedClassIds={[...completedClassIds]}
      completedModuleIds={[...completedModuleIds]}
      selectedClassId={selectedClassId}
      isCurrent={isCurrent}
      neverPaid={neverPaid}
    />
  );
};

export default Page;
