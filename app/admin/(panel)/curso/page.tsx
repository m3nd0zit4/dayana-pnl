import CourseMembersPageClient from "@/app/components/admin/crm/CourseMembersPageClient";
import { isCrmUiPreview } from "@/lib/auth/preview";
import { getStaffSession } from "@/lib/auth/staff-session";
import { getMembershipProduct } from "@/lib/lms/membership";
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

  // La membresía es lo que se paga; los cursos de la biblioteca no tienen
  // inscripciones propias.
  const membership = await getMembershipProduct();
  const members = membership ? await listCourseMembersAdmin(membership.id) : [];

  return (
    <CourseMembersPageClient
      preview={false}
      courseTitle={membership?.title ?? "Membresía"}
      courseProductId={membership?.id ?? null}
      initialMembers={members}
    />
  );
};

export default CursoPage;
