import CourseMembersPageClient from "@/app/components/admin/crm/CourseMembersPageClient";
import { isCrmUiPreview } from "@/lib/auth/preview";
import { getStaffSession } from "@/lib/auth/staff-session";
import { getCourseProduct } from "@/lib/lms/membership";
import { listCourseMembersAdmin } from "@/lib/lms/course-admin";

export const dynamic = "force-dynamic";

const CursoPage = async () => {
  const preview = isCrmUiPreview();
  if (preview) {
    return (
      <CourseMembersPageClient
        preview
        courseTitle="Curso en vivo"
        courseProductId={null}
        initialMembers={[]}
      />
    );
  }

  const staff = await getStaffSession();
  if (!staff) return null;

  const course = await getCourseProduct();
  const members = course ? await listCourseMembersAdmin(course.id) : [];

  return (
    <CourseMembersPageClient
      preview={false}
      courseTitle={course?.title ?? "Curso"}
      courseProductId={course?.id ?? null}
      initialMembers={members}
    />
  );
};

export default CursoPage;
