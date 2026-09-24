import { requireOwnerSettings } from "@/app/admin/(panel)/ajustes/owner-gate";
import CrmPageShell from "@/app/components/admin/crm/CrmPageShell";
import WhatsAppSettingsClient from "@/app/components/admin/whatsapp/settings/WhatsAppSettingsClient";
import { isCrmUiPreview } from "@/lib/auth/preview";
import { listActiveGoogleAccountsForService } from "@/lib/crm/google-accounts";
import { defaultWhatsAppAiConfig, getWhatsAppAiConfig } from "@/lib/crm/whatsapp-ai-config";
import { isWhatsAppAutoReplyEnabled } from "@/lib/crm/whatsapp-autoreply";
import { getLearningSummary } from "@/lib/crm/whatsapp-learning";
import {
  DEFAULT_WHATSAPP_SETTINGS_TAB,
  isWhatsAppSettingsTab,
} from "@/lib/crm/whatsapp-settings-registry";
import { listWhatsAppTemplates } from "@/lib/crm/whatsapp-templates";
import { defaultWelcomeConfig, getWelcomeConfig } from "@/lib/crm/whatsapp-welcome";
import {
  getWhatsAppProviderSummary,
  resolveWhatsAppCredentials,
} from "@/lib/meta/whatsapp-provider";

export const dynamic = "force-dynamic";

/** Aprobadas, en revisión y rechazadas, como las pinta la pantalla de plantillas. */
const countTemplates = (statuses: (string | null)[]) => {
  const counts = { approved: 0, pending: 0, rejected: 0 };
  for (const raw of statuses) {
    const s = (raw ?? "").toUpperCase();
    if (s === "APPROVED") counts.approved++;
    else if (s.startsWith("REJECTED") || s === "DISABLED") counts.rejected++;
    else counts.pending++;
  }
  return counts;
};

/**
 * Todo lo que se configura de WhatsApp, en un solo sitio y por pestañas:
 * conexión, IA, citas, avisos, plantillas y avanzado. `?tab=` abre una.
 */
const Page = async ({ searchParams }: { searchParams: Promise<{ tab?: string | string[] }> }) => {
  await requireOwnerSettings();
  const { tab: rawTab } = await searchParams;
  const tab = isWhatsAppSettingsTab(rawTab) ? rawTab : DEFAULT_WHATSAPP_SETTINGS_TAB;

  if (isCrmUiPreview()) {
    return (
      <CrmPageShell width="narrow">
        <WhatsAppSettingsClient
          preview
          initialTab={tab}
          initialConfig={defaultWhatsAppAiConfig()}
          initialEnabled={false}
          initialSummary={{
            total: 0,
            enabled: 0,
            pendingEmbedding: 0,
            imported: 0,
            knownContacts: 0,
            lastLearnedAt: null,
          }}
          initialWelcome={defaultWelcomeConfig()}
          configured={false}
          provider={null}
          calendarAccounts={[]}
          templateCounts={null}
        />
      </CrmPageShell>
    );
  }

  const [config, enabled, summary, credentials, provider, welcome, accounts, templates] = await Promise.all([
    getWhatsAppAiConfig(),
    isWhatsAppAutoReplyEnabled(),
    getLearningSummary(),
    resolveWhatsAppCredentials(),
    getWhatsAppProviderSummary(),
    getWelcomeConfig(),
    listActiveGoogleAccountsForService("CALENDAR"),
    listWhatsAppTemplates(),
  ]);

  return (
    <CrmPageShell width="narrow">
      <WhatsAppSettingsClient
        initialTab={tab}
        initialConfig={config}
        initialEnabled={enabled}
        initialSummary={summary}
        initialWelcome={welcome}
        configured={credentials !== null}
        provider={provider}
        calendarAccounts={accounts.map((a) => ({ id: a.id, email: a.email, displayName: a.displayName }))}
        templateCounts={countTemplates(templates.map((t) => t.metaApprovalStatus))}
      />
    </CrmPageShell>
  );
};

export default Page;
