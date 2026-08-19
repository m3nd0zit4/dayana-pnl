import CourseModulesPageClient from "@/app/components/admin/crm/CourseModulesPageClient";
import { isCrmUiPreview } from "@/lib/auth/preview";
import { getStaffSession } from "@/lib/auth/staff-session";
import {
  listCourseModulesAdmin,
  listCoursesAdmin,
  resolveCourseProduct,
} from "@/lib/lms/course-admin";

export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<{ curso?: string }> };

const CursoModulosPage = async ({ searchParams }: Props) => {
  const preview = isCrmUiPreview();
  if (preview) {
    return (
      <CourseModulesPageClient preview initialModules={[]} courses={[]} activeCourseId={null} />
    );
  }

  const staff = await getStaffSession();
  if (!staff) return null;

  const { curso } = await searchParams;
  const [courses, course] = await Promise.all([
    listCoursesAdmin(),
    resolveCourseProduct(curso),
  ]);
  const modules = course ? await listCourseModulesAdmin(course.id) : [];

  return (
    <CourseModulesPageClient
      preview={false}
      activeCourseId={course?.id ?? null}
      courses={courses.map((c) => ({
        id: c.id,
        title: c.title,
        isActive: c.isActive,
        isCourseContent: c.isCourseContent,
        moduleCount: c.moduleCount,
        classCount: c.classCount,
      }))}
      initialModules={modules.map((m) => ({
        id: m.id,
        title: m.title,
        bodyMd: m.bodyMd,
        sortOrder: m.sortOrder,
        isPublished: m.isPublished,
        classCount: m.classCount,
        commentCount: m.commentCount,
      }))}
    />
  );
};

export default CursoModulosPage;
