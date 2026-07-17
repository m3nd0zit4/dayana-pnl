import { notFound } from "next/navigation";
import CourseModuleDetailClient from "@/app/components/admin/crm/CourseModuleDetailClient";
import { isCrmUiPreview } from "@/lib/auth/preview";
import { getStaffSession } from "@/lib/auth/staff-session";
import { getCourseModuleAdmin } from "@/lib/lms/course-admin";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }> };

const CourseModuleDetailPage = async ({ params }: Props) => {
  const { id } = await params;
  const preview = isCrmUiPreview();

  if (preview) {
    return (
      <CourseModuleDetailClient
        preview
        module={{ id, title: "", bodyMd: null, isPublished: false }}
        initialClasses={[]}
      />
    );
  }

  const staff = await getStaffSession();
  if (!staff) return null;

  const courseModule = await getCourseModuleAdmin(id);
  if (!courseModule) notFound();

  return (
    <CourseModuleDetailClient
      preview={false}
      module={{
        id: courseModule.id,
        title: courseModule.title,
        bodyMd: courseModule.bodyMd,
        isPublished: courseModule.isPublished,
      }}
      initialClasses={courseModule.classes.map((c) => ({
        id: c.id,
        title: c.title,
        description: c.description,
        scheduledAt: c.scheduledAt ? c.scheduledAt.toISOString() : null,
        meetUrl: c.meetUrl,
        recordingUrl: c.recordingUrl,
        recordingPostedAt: c.recordingPostedAt ? c.recordingPostedAt.toISOString() : null,
        recordingHiddenAt: c.recordingHiddenAt ? c.recordingHiddenAt.toISOString() : null,
        commentCount: c._count.comments,
      }))}
    />
  );
};

export default CourseModuleDetailPage;
