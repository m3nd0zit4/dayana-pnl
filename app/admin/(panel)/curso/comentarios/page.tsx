import CourseCommentsPageClient from "@/app/components/admin/crm/CourseCommentsPageClient";
import { isCrmUiPreview } from "@/lib/auth/preview";
import { getStaffSession } from "@/lib/auth/staff-session";
import { listCoursesAdmin } from "@/lib/lms/course-admin";
import { listRecentCommentsForProduct } from "@/lib/lms/class-comments";

export const dynamic = "force-dynamic";

const CursoComentariosPage = async () => {
  const preview = isCrmUiPreview();
  if (preview) {
    return <CourseCommentsPageClient preview initialComments={[]} />;
  }

  const staff = await getStaffSession();
  if (!staff) return null;

  // Comentarios de toda la biblioteca en una sola bandeja.
  const courses = await listCoursesAdmin();
  const comments =
    courses.length > 0
      ? await listRecentCommentsForProduct(courses.map((c) => c.id))
      : [];

  return (
    <CourseCommentsPageClient
      preview={false}
      initialComments={comments.map((c) => ({
        id: c.id,
        body: c.body,
        createdAt: c.createdAt.toISOString(),
        contactFirstName: c.contactFirstName,
        classId: c.classId,
        classTitle: c.classTitle,
        moduleId: c.moduleId,
        moduleTitle: c.moduleTitle,
      }))}
    />
  );
};

export default CursoComentariosPage;
