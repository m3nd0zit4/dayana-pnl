import WhatsAppAiSettingsClient from "@/app/components/admin/crm/settings/WhatsAppAiSettingsClient";
import { requireOwnerSettings } from "@/app/admin/(panel)/ajustes/owner-gate";
import { isCrmUiPreview } from "@/lib/auth/preview";
import {
  defaultWhatsAppAiConfig,
  getWhatsAppAiConfig,
} from "@/lib/crm/whatsapp-ai-config";
import { isWhatsAppAutoReplyEnabled } from "@/lib/crm/whatsapp-autoreply";
import { getLearningSummary } from "@/lib/crm/whatsapp-learning";
import { resolveWhatsAppCredentials } from "@/lib/meta/whatsapp-provider";

export const dynamic = "force-dynamic";

const EMPTY_SUMMARY = {
  total: 0,
  enabled: 0,
  pendingEmbedding: 0,
  imported: 0,
  knownContacts: 0,
  lastLearnedAt: null,
};

const Page = async () => {
  await requireOwnerSettings();

  if (isCrmUiPreview()) {
    return (
      <WhatsAppAiSettingsClient
        initialConfig={defaultWhatsAppAiConfig()}
        initialEnabled={false}
        initialSummary={EMPTY_SUMMARY}
        configured={false}
      />
    );
  }

  const [config, enabled, summary, credentials] = await Promise.all([
    getWhatsAppAiConfig(),
    isWhatsAppAutoReplyEnabled(),
    getLearningSummary(),
    resolveWhatsAppCredentials(),
  ]);

  return (
    <WhatsAppAiSettingsClient
      initialConfig={config}
      initialEnabled={enabled}
      initialSummary={summary}
      configured={credentials !== null}
    />
  );
};

export default Page;
