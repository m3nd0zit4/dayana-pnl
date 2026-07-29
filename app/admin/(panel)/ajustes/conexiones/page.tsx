import SocialConnectionsClient from "@/app/components/admin/crm/settings/SocialConnectionsClient";
import { getSocialConnections } from "@/lib/crm/social-accounts";
import { requireOwnerSettings } from "../owner-gate";

export const dynamic = "force-dynamic";

const Page = async ({
  searchParams,
}: {
  searchParams: Promise<{ meta?: string; tiktok?: string }>;
}) => {
  await requireOwnerSettings();

  const [params, connections] = await Promise.all([
    searchParams,
    getSocialConnections(),
  ]);

  return (
    <SocialConnectionsClient
      initialConnections={connections}
      metaResult={params.meta ?? null}
      tiktokResult={params.tiktok ?? null}
    />
  );
};

export default Page;
