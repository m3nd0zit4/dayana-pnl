import { requireOwnerSettings } from "@/app/admin/(panel)/ajustes/owner-gate";
import CrmPageShell from "@/app/components/admin/crm/CrmPageShell";
import WhatsAppAiSettingsClient from "@/app/components/admin/crm/settings/WhatsAppAiSettingsClient";
import WhatsAppProviderCard from "@/app/components/admin/crm/settings/WhatsAppProviderCard";
import WhatsAppWelcomeCard from "@/app/components/admin/crm/settings/WhatsAppWelcomeCard";
import HistoryImportCard from "@/app/components/admin/whatsapp/HistoryImportCard";
import PushToggle from "@/app/components/admin/whatsapp/PushToggle";
import WhatsAppBehaviorCard from "@/app/components/admin/whatsapp/WhatsAppBehaviorCard";
import WhatsAppPlaybooksCard from "@/app/components/admin/whatsapp/WhatsAppPlaybooksCard";
import { isCrmUiPreview } from "@/lib/auth/preview";
import { defaultWhatsAppAiConfig, getWhatsAppAiConfig } from "@/lib/crm/whatsapp-ai-config";
import { isWhatsAppAutoReplyEnabled } from "@/lib/crm/whatsapp-autoreply";
import { getLearningSummary } from "@/lib/crm/whatsapp-learning";
import { getWelcomeConfig } from "@/lib/crm/whatsapp-welcome";
import {
  getWhatsAppProviderSummary,
  resolveWhatsAppCredentials,
} from "@/lib/meta/whatsapp-provider";

export const dynamic = "force-dynamic";

/**
 * Todo lo que se configura de WhatsApp, en un solo sitio: conexión, cómo se
 * comporta la IA, sus procedimientos, lo que aprendió, el saludo y los avisos.
 */
const Page = async () => {
  await requireOwnerSettings();

  if (isCrmUiPreview()) {
    const config = defaultWhatsAppAiConfig();
    return (
      <CrmPageShell>
        <WhatsAppBehaviorCard initialMode={config.defaultMode} initialHolding="" initialOutreach={config.diagnosticOutreach} />
      </CrmPageShell>
    );
  }

  const [config, enabled, summary, credentials, provider, welcome] = await Promise.all([
    getWhatsAppAiConfig(),
    isWhatsAppAutoReplyEnabled(),
    getLearningSummary(),
    resolveWhatsAppCredentials(),
    getWhatsAppProviderSummary(),
    getWelcomeConfig(),
  ]);

  return (
    <CrmPageShell>
      <h1 className="text-xl font-semibold">Ajustes de WhatsApp</h1>
      <WhatsAppProviderCard initial={provider} />
      <HistoryImportCard />
      <WhatsAppBehaviorCard
        initialMode={config.defaultMode}
        initialHolding={config.escalation.holdingMessage}
        initialOutreach={config.diagnosticOutreach}
      />
      <WhatsAppPlaybooksCard />
      <PushToggle />
      <WhatsAppAiSettingsClient
        initialConfig={config}
        initialEnabled={enabled}
        initialSummary={summary}
        configured={credentials !== null}
      />
      <WhatsAppWelcomeCard initial={welcome} configured={credentials !== null} />
    </CrmPageShell>
  );
};

export default Page;
