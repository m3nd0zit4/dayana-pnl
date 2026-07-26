import SiteGeneralSettingsClient from "@/app/components/admin/crm/settings/SiteGeneralSettingsClient";
import { OPERATIONAL_TZ } from "@/lib/crm/operational-timezone";
import { getUsdToCopRateSetting, resolveUsdToCopRate } from "@/lib/crm/site-settings";
import { siteUrl } from "@/lib/notifications/config";

export const dynamic = "force-dynamic";

const Page = async () => {
  const usdToCopRate = await resolveUsdToCopRate();
  const fromCrm = await getUsdToCopRateSetting();

  return (
    <SiteGeneralSettingsClient
      initialRate={usdToCopRate}
      initialSource={fromCrm != null ? "crm" : "env_or_default"}
      operationalTimezone={OPERATIONAL_TZ}
      publicSiteUrl={siteUrl()}
    />
  );
};

export default Page;
