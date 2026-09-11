import SubscriptionsPageClient from "@/app/components/admin/crm/SubscriptionsPageClient";
import { isCrmUiPreview } from "@/lib/auth/preview";
import { getStaffSession } from "@/lib/auth/staff-session";
import { getSubscriptionsOverview } from "@/lib/crm/subscriptions";

export const dynamic = "force-dynamic";

/**
 * En vista previa se sirve vacío, como el resto de rutas del contrato: sin
 * `DATABASE_URL` no hay a quién preguntar, y lo que la suite comprueba es el
 * marco de la página y sus estados vacíos.
 */
const SuscripcionesPage = async () => {
  if (isCrmUiPreview()) {
    return <SubscriptionsPageClient preview plans={[]} subscribers={[]} />;
  }

  const staff = await getStaffSession();
  if (!staff) return null;

  const { plans, subscribers } = await getSubscriptionsOverview();

  return (
    <SubscriptionsPageClient
      preview={false}
      plans={plans}
      subscribers={subscribers}
    />
  );
};

export default SuscripcionesPage;
