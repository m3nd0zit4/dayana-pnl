import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { ProductKind } from "@prisma/client";
import { prisma } from "@/lib/db";
import { BRAND } from "@/lib/contact";
import { getPortalViewer } from "@/lib/auth/portal-viewer";
import { getEnrolledCourses, isNeverPaid } from "@/lib/lms/membership";
import { getCourseOutline, sanitizeQuizForMember } from "@/lib/lms/course-content";
import { readExercise } from "@/lib/lms/exercise";
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

  const member = await getPortalViewer();
  if (!member) redirect("/acceso");

  const product = await prisma.product.findUnique({ where: { id: productId } });
  if (!product || product.kind !== ProductKind.COURSE) notFound();

  const enrolledCourses = await getEnrolledCourses(member.contact.id, {
    isOwner: member.isOwner,
  });
  const enrolled = enrolledCourses.find((c) => c.product.id === productId);
  const isCurrent = enrolled?.membership.isCurrent ?? false;
  // `paidUntil == null` ya no basta: una compra suelta deja esa fecha vacía y
  // aun así está pagada a perpetuidad.
  const neverPaid = !enrolled || isNeverPaid(enrolled.membership);

  const [modules, completedClassIds, completedModuleIds, progress] = await Promise.all([
    getCourseOutline(productId),
    getCompletedClassIds(member.contact.id, productId),
    getCompletedModuleIds(member.contact.id, productId),
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
          muxPlaybackId: cls.recordingStatus === "READY" ? cls.muxPlaybackId : null,
          recordingDurationSec: cls.recordingDurationSec,
          recordingPostedAt: cls.recordingPostedAt
            ? cls.recordingPostedAt.toISOString()
            : null,
          recordingHiddenAt: cls.recordingHiddenAt
            ? cls.recordingHiddenAt.toISOString()
            : null,
          evergreen: cls.evergreen,
          contentType: cls.contentType,
          bodyMd: cls.bodyMd,
          materialFileName: cls.materialFileName,
          materialSizeBytes: cls.materialSizeBytes,
          quiz: cls.contentType === "QUIZ" ? sanitizeQuizForMember(cls.quizJson) : null,
          exercise: cls.contentType === "EXERCISE" ? readExercise(cls.exerciseJson) : null,
        })),
      }))}
      completedClassIds={[...completedClassIds]}
      completedModuleIds={[...completedModuleIds]}
      selectedClassId={selectedClassId}
      percent={progress.percent}
      isCurrent={isCurrent}
      neverPaid={neverPaid}
      viewerContactId={member.contact.id}
    />
  );
};

export default Page;
