import CourseClassesPageClient from "@/app/components/admin/crm/CourseClassesPageClient";
import { isCrmUiPreview } from "@/lib/auth/preview";
import { getStaffSession } from "@/lib/auth/staff-session";
import { getCourseProduct } from "@/lib/lms/membership";
import { listLiveClassesAdmin } from "@/lib/lms/course-admin";

export const dynamic = "force-dynamic";

const CursoClasesPage = async () => {
  const preview = isCrmUiPreview();
  if (preview) {
    return <CourseClassesPageClient preview initialClasses={[]} />;
  }

  const staff = await getStaffSession();
  if (!staff) return null;

  const course = await getCourseProduct();
  const classes = course ? await listLiveClassesAdmin(course.id) : [];

  return (
    <CourseClassesPageClient
      preview={false}
      initialClasses={classes.map((c) => ({
        id: c.id,
        title: c.title,
        description: c.description,
        scheduledAt: c.scheduledAt?.toISOString() ?? null,
        meetUrl: c.meetUrl,
        recordingUrl: c.recordingUrl,
        recordingPostedAt: c.recordingPostedAt?.toISOString() ?? null,
        recordingHiddenAt: c.recordingHiddenAt?.toISOString() ?? null,
      }))}
    />
  );
};

export default CursoClasesPage;
