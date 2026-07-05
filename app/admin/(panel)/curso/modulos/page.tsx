import CourseModulesPageClient from "@/app/components/admin/crm/CourseModulesPageClient";
import { isCrmUiPreview } from "@/lib/auth/preview";
import { getStaffSession } from "@/lib/auth/staff-session";
import { getCourseProduct } from "@/lib/lms/membership";
import { listCourseModulesAdmin } from "@/lib/lms/course-admin";

export const dynamic = "force-dynamic";

const CursoModulosPage = async () => {
  const preview = isCrmUiPreview();
  if (preview) {
    return <CourseModulesPageClient preview initialModules={[]} />;
  }

  const staff = await getStaffSession();
  if (!staff) return null;

  const course = await getCourseProduct();
  const modules = course ? await listCourseModulesAdmin(course.id) : [];

  return (
    <CourseModulesPageClient
      preview={false}
      initialModules={modules.map((m) => ({
        id: m.id,
        title: m.title,
        bodyMd: m.bodyMd,
        sortOrder: m.sortOrder,
        isPublished: m.isPublished,
      }))}
    />
  );
};

export default CursoModulosPage;
