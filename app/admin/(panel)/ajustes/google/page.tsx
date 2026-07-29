import GoogleAccountsClient from "@/app/components/admin/crm/settings/GoogleAccountsClient";
import { requireOwnerSettings } from "@/app/admin/(panel)/ajustes/owner-gate";
import { listGoogleAccounts } from "@/lib/crm/google-accounts";
import { isGoogleEnabled } from "@/lib/google/connect";

export const dynamic = "force-dynamic";

const Page = async ({
  searchParams,
}: {
  searchParams: Promise<{ google?: string }>;
}) => {
  await requireOwnerSettings();

  const { google } = await searchParams;

  return (
    <GoogleAccountsClient
      enabled={isGoogleEnabled()}
      initialAccounts={await listGoogleAccounts()}
      connectResult={google ?? null}
    />
  );
};

export default Page;
