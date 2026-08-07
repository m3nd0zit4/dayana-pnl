import { notFound } from "next/navigation";
import EnrollmentDetailClient from "@/app/components/admin/EnrollmentDetailClient";
import CrmPageShell from "@/app/components/admin/crm/CrmPageShell";
import { getEnrollmentById } from "@/lib/crm/enrollments";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }> };

const EnrollmentPage = async ({ params }: Props) => {
  const { id } = await params;
  const enrollment = await getEnrollmentById(id).catch(() => null);
  if (!enrollment) notFound();

  return (
    <CrmPageShell>
      {/* «Volver» lo pinta CrmPageHeader dentro del cliente, junto al título. */}
      <EnrollmentDetailClient
        enrollment={{
          ...enrollment,
          therapyPackage: enrollment.therapyPackage
            ? {
                id: enrollment.therapyPackage.id,
                totalSessions: enrollment.therapyPackage.totalSessions,
                usedSessions: enrollment.therapyPackage.usedSessions,
                meetDefaultUrl: enrollment.therapyPackage.meetDefaultUrl,
                reprogrammingNotes: enrollment.therapyPackage.reprogrammingNotes,
                sessions: enrollment.therapyPackage.sessions.map((s) => ({
                  id: s.id,
                  sessionNumber: s.sessionNumber,
                  status: s.status,
                  scheduledAt: s.scheduledAt?.toISOString() ?? null,
                  meetUrl: s.meetUrl,
                  durationMinutes: s.durationMinutes,
                })),
              }
            : null,
        }}
      />
    </CrmPageShell>
  );
};

export default EnrollmentPage;
