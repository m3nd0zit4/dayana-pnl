import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { BRAND } from "@/lib/contact";
import { prisma } from "@/lib/db";
import { getPortalViewer } from "@/lib/auth/portal-viewer";
import { getCourseProduct, getEnrolledCourses } from "@/lib/lms/membership";
import { getCourseProgress } from "@/lib/lms/class-progress";
import LearningDashboard, {
  type CourseCardData,
} from "@/app/components/miembros/LearningDashboard";

export const metadata: Metadata = {
  title: `Portal de miembros — ${BRAND.name}`,
  robots: { index: false, follow: false },
};

const Page = async () => {
  const member = await getPortalViewer();
  if (!member) redirect("/acceso");

  let enrolled = await getEnrolledCourses(member.contact.id, { isOwner: member.isOwner });

  // Edge case: a portal account with no enrollment record at all (e.g. the
  // enrollment was removed after signup). Show the site's course as a
  // not-yet-activated card rather than an empty dashboard.
  if (enrolled.length === 0) {
    const fallback = await getCourseProduct();
    if (fallback) {
      enrolled = [
        {
          product: fallback,
          membership: { enrollment: null, paidUntil: null, isCurrent: false, daysLeft: null },
        },
      ];
    }
  }

  const courses: CourseCardData[] = await Promise.all(
    enrolled.map(async ({ product, membership }) => {
      const [progress, moduleCount] = await Promise.all([
        getCourseProgress(product.id, member.contact.id),
        prisma.courseModule.count({
          where: { productId: product.id, isPublished: true },
        }),
      ]);
      return {
        productId: product.id,
        title: product.title,
        description: product.description,
        moduleCount,
        imageUrl: product.imageUrl,
        percent: progress.percent,
        completedClasses: progress.completedClasses,
        totalClasses: progress.totalClasses,
        nextIncompleteClassId: progress.nextIncompleteClassId,
        isCurrent: membership.isCurrent,
        neverPaid: membership.paidUntil == null,
      };
    })
  );

  return <LearningDashboard firstName={member.contact.firstName} courses={courses} />;
};

export default Page;
