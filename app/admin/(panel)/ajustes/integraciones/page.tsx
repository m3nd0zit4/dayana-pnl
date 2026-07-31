import IntegrationsHealthClient from "@/app/components/admin/crm/settings/IntegrationsHealthClient";
import IntegrationsOverviewStrip from "@/app/components/admin/crm/settings/IntegrationsOverviewStrip";
import PaymentsHealthCard from "@/app/components/admin/crm/settings/PaymentsHealthCard";
import SocialConnectionsClient from "@/app/components/admin/crm/settings/SocialConnectionsClient";
import SocialPublishingTogglesClient from "@/app/components/admin/crm/settings/SocialPublishingTogglesClient";
import GoogleAccountsClient from "@/app/components/admin/crm/settings/GoogleAccountsClient";
import {
  getIntegrationHealth,
  getNotificationsRuntimeStatus,
} from "@/lib/notifications/health";
import { getSocialConnections } from "@/lib/crm/social-accounts";
import { listGoogleAccounts } from "@/lib/crm/google-accounts";
import { isGoogleEnabled } from "@/lib/google/connect";
import { getIntegrationsOverview } from "@/lib/crm/integrations";
import { requireOwnerSettings } from "@/app/admin/(panel)/ajustes/owner-gate";
import { getStaffSession } from "@/lib/auth/staff-session";
import {
  getSocialPublishingOverride,
  getTiktokAuditedOverride,
  resolveSocialPublishingEnabled,
  resolveTiktokAudited,
} from "@/lib/tiktok/resolve-flags";

export const dynamic = "force-dynamic";

/**
 * Hub único de integraciones/conexiones (ver plan de diseño): reemplaza el
 * reparto anterior en tres pantallas (Integraciones, Google, Redes sociales)
 * por una sola, agrupada según `INTEGRATION_GROUPS`. `/ajustes/google` y
 * `/ajustes/conexiones` quedan como redirects aquí para no romper enlaces
 * guardados.
 */
const Page = async ({
  searchParams,
}: {
  searchParams: Promise<{ meta?: string; tiktok?: string; google?: string }>;
}) => {
  await requireOwnerSettings();

  const [
    params,
    staff,
    connections,
    googleAccounts,
    overview,
    publishingEnabled,
    publishingOverride,
    audited,
    auditedOverride,
  ] = await Promise.all([
    searchParams,
    getStaffSession(),
    getSocialConnections(),
    listGoogleAccounts(),
    getIntegrationsOverview(),
    resolveSocialPublishingEnabled(),
    getSocialPublishingOverride(),
    resolveTiktokAudited(),
    getTiktokAuditedOverride(),
  ]);

  // Google ya tiene su propia sección detallada más abajo; repetirlo aquí
  // sería la misma fila dos veces con menos información.
  const systemIntegrations = getIntegrationHealth().filter(
    (i) => i.id !== "google" && i.id !== "paypal" && i.id !== "mercadopago"
  );

  return (
    <div className="space-y-10">
      <IntegrationsOverviewStrip items={overview} />

      <section id="pagos" className="scroll-mt-20 space-y-4">
        <h2 className="text-lg font-semibold tracking-tight">Pagos</h2>
        <PaymentsHealthCard />
      </section>

      <section id="redes-sociales" className="scroll-mt-20 space-y-4">
        <h2 className="text-lg font-semibold tracking-tight">
          Redes sociales
        </h2>
        <SocialConnectionsClient
          initialConnections={connections}
          metaResult={params.meta ?? null}
          tiktokResult={params.tiktok ?? null}
        />
        <SocialPublishingTogglesClient
          publishingEnabled={publishingEnabled}
          publishingOverride={publishingOverride}
          audited={audited}
          auditedOverride={auditedOverride}
        />
      </section>

      <section id="google" className="scroll-mt-20 space-y-4">
        <h2 className="text-lg font-semibold tracking-tight">Google</h2>
        <GoogleAccountsClient
          enabled={isGoogleEnabled()}
          initialAccounts={googleAccounts}
          connectResult={params.google ?? null}
        />
      </section>

      <section id="sistema" className="scroll-mt-20 space-y-4">
        <h2 className="text-lg font-semibold tracking-tight">Sistema</h2>
        <IntegrationsHealthClient
          initialIntegrations={systemIntegrations}
          runtime={getNotificationsRuntimeStatus()}
          defaultTestEmail={staff?.email ?? ""}
        />
      </section>
    </div>
  );
};

export default Page;
