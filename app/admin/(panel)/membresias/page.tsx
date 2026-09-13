import MembershipsPageClient, {
  type MembershipsTab,
} from "@/app/components/admin/crm/MembershipsPageClient";
import type { MemberFilter } from "@/app/components/admin/crm/CourseMembersPageClient";
import { isCrmUiPreview } from "@/lib/auth/preview";
import { getStaffSession } from "@/lib/auth/staff-session";
import { getSubscriptionsOverview } from "@/lib/crm/subscriptions";
import { listCourseMembersAdmin } from "@/lib/lms/course-admin";
import { getMembershipProduct } from "@/lib/lms/membership";

export const dynamic = "force-dynamic";

const tabFrom = (raw: string | string[] | undefined): MembershipsTab =>
  raw === "planes" ? "planes" : "personas";

const filterFrom = (raw: string | string[] | undefined): MemberFilter | null =>
  raw === "vencidas" || raw === "por-vencer" ? raw : null;

const MembresiasPage = async ({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string | string[]; filtro?: string | string[] }>;
}) => {
  const params = await searchParams;
  const initialTab = tabFrom(params.tab);
  const memberFilter = filterFrom(params.filtro);

  if (isCrmUiPreview()) {
    return (
      <MembershipsPageClient
        preview
        initialTab={initialTab}
      memberFilter={memberFilter}
        courseTitle="Curso en vivo"
        courseProductId={null}
        members={[]}
        plans={[]}
        subscribers={[]}
      />
    );
  }

  const staff = await getStaffSession();
  if (!staff) return null;

  // La membresía es lo que se paga; los cursos de la biblioteca no tienen
  // inscripciones propias.
  const membership = await getMembershipProduct();
  const [members, { plans, subscribers }] = await Promise.all([
    membership ? listCourseMembersAdmin(membership.id) : Promise.resolve([]),
    getSubscriptionsOverview(),
  ]);

  return (
    <MembershipsPageClient
      preview={false}
      initialTab={initialTab}
      memberFilter={memberFilter}
      courseTitle={membership?.title ?? "Membresía"}
      courseProductId={membership?.id ?? null}
      members={members}
      plans={plans}
      subscribers={subscribers}
    />
  );
};

export default MembresiasPage;
