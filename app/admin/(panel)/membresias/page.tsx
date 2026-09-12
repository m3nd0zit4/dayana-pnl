import MembershipsPageClient, {
  type MembershipsTab,
} from "@/app/components/admin/crm/MembershipsPageClient";
import { isCrmUiPreview } from "@/lib/auth/preview";
import { getStaffSession } from "@/lib/auth/staff-session";
import { getSubscriptionsOverview } from "@/lib/crm/subscriptions";
import { listCourseMembersAdmin } from "@/lib/lms/course-admin";
import { getMembershipProduct } from "@/lib/lms/membership";

export const dynamic = "force-dynamic";

const tabFrom = (raw: string | string[] | undefined): MembershipsTab =>
  raw === "planes" ? "planes" : "personas";

const MembresiasPage = async ({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string | string[] }>;
}) => {
  const initialTab = tabFrom((await searchParams).tab);

  if (isCrmUiPreview()) {
    return (
      <MembershipsPageClient
        preview
        initialTab={initialTab}
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
      courseTitle={membership?.title ?? "Membresía"}
      courseProductId={membership?.id ?? null}
      members={members}
      plans={plans}
      subscribers={subscribers}
    />
  );
};

export default MembresiasPage;
