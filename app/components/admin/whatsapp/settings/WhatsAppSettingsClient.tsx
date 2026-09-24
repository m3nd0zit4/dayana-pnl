"use client";

import { Bell, Bot, CalendarClock, FileText, Plug, SlidersHorizontal } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import CrmPageHeader from "../../crm/CrmPageHeader";
import type { WhatsAppProviderSummaryDto } from "../../crm/settings/WhatsAppProviderCard";
import type { WhatsAppAiConfig } from "@/lib/crm/whatsapp-ai-config";
import {
  WHATSAPP_SETTINGS_TABS,
  type WhatsAppSettingEntry,
  type WhatsAppSettingsTab,
} from "@/lib/crm/whatsapp-settings-registry";
import AdvancedTab from "./AdvancedTab";
import AiMasterBar from "./AiMasterBar";
import AiTab from "./AiTab";
import AlertsTab, { type WelcomeConfigDto } from "./AlertsTab";
import BookingTab, { type CalendarAccountDto } from "./BookingTab";
import ConnectionTab from "./ConnectionTab";
import {
  SettingsContext,
  WHATSAPP_AI_API,
  type LearningSummaryDto,
  type SettingsCtx,
} from "./context";
import SettingsSearch from "./SettingsSearch";
import SettingsTabs, { type SettingsTabItem } from "./SettingsTabs";
import TemplatesTab, { type TemplateCountsDto } from "./TemplatesTab";
import { patchAt, setIn, useAutosave } from "./useAutosave";

const ICONS: Record<WhatsAppSettingsTab, SettingsTabItem<WhatsAppSettingsTab>["icon"]> = {
  conexion: Plug,
  ia: Bot,
  citas: CalendarClock,
  avisos: Bell,
  plantillas: FileText,
  avanzado: SlidersHorizontal,
};

const TABS: SettingsTabItem<WhatsAppSettingsTab>[] = WHATSAPP_SETTINGS_TABS.map((t) => ({
  id: t.id,
  label: t.label,
  icon: ICONS[t.id],
}));

/**
 * Ajustes de WhatsApp en pestañas. Arriba, siempre: el interruptor de la IA,
 * el modo de los chats nuevos y un buscador de ajustes. Todo se guarda solo.
 */
const WhatsAppSettingsClient = ({
  initialTab,
  initialConfig,
  initialEnabled,
  initialSummary,
  initialWelcome,
  configured,
  provider,
  calendarAccounts,
  templateCounts,
  preview = false,
}: {
  initialTab: WhatsAppSettingsTab;
  initialConfig: WhatsAppAiConfig;
  initialEnabled: boolean;
  initialSummary: LearningSummaryDto;
  initialWelcome: WelcomeConfigDto;
  configured: boolean;
  provider: WhatsAppProviderSummaryDto | null;
  calendarAccounts: CalendarAccountDto[];
  templateCounts: TemplateCountsDto | null;
  preview?: boolean;
}) => {
  const [tab, setTabState] = useState(initialTab);
  const [config, setConfig] = useState(initialConfig);
  const [enabled, setEnabled] = useState(initialEnabled);
  const [summary, setSummary] = useState(initialSummary);
  const [welcome, setWelcome] = useState(initialWelcome);
  const { states, save, fail } = useAutosave({ disabled: preview });

  const setTab = useCallback((next: WhatsAppSettingsTab) => {
    setTabState(next);
    const url = new URL(window.location.href);
    url.searchParams.set("tab", next);
    window.history.replaceState(window.history.state, "", url);
  }, []);

  const change = useCallback<SettingsCtx["change"]>(
    (key, path, value, delay = 0) => {
      setConfig((c) => setIn(c, path, value));
      save(key, WHATSAPP_AI_API, { patch: patchAt(path, value) }, delay);
    },
    [save]
  );

  // Del buscador: cambiar de pestaña, bajar hasta el ajuste y resaltarlo.
  const [target, setTarget] = useState<string | null>(null);
  const pick = useCallback(
    (entry: WhatsAppSettingEntry) => {
      setTab(entry.tab);
      setTarget(entry.id);
    },
    [setTab]
  );
  useEffect(() => {
    if (!target) return;
    const t = setTimeout(() => {
      const el = document.getElementById(target);
      if (!el) return;
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.dataset.highlight = "true";
      setTimeout(() => {
        delete el.dataset.highlight;
      }, 2200);
      setTarget(null);
    }, 60);
    return () => clearTimeout(t);
  }, [target, tab]);

  const ctx = useMemo<SettingsCtx>(
    () => ({ config, change, states, fail, save, summary, setSummary, preview }),
    [config, change, states, fail, save, summary, preview]
  );

  return (
    <SettingsContext.Provider value={ctx}>
      <CrmPageHeader
        title="Ajustes de WhatsApp"
        description="Todo se guarda solo al cambiarlo."
        secondaryActions={<SettingsSearch onPick={pick} />}
      />

      <div className="z-20 -mx-1 space-y-3 bg-background/95 px-1 pt-1 pb-3 sm:sticky sm:top-0 sm:backdrop-blur sm:supports-[backdrop-filter]:bg-background/80">
        <AiMasterBar
          enabled={enabled}
          onEnabled={(v) => {
            setEnabled(v);
            save("wa-ai-enabled", WHATSAPP_AI_API, { enabled: v });
          }}
          enabledState={states["wa-ai-enabled"]}
          mode={config.defaultMode}
          onMode={(v) => change("wa-default-mode", "defaultMode", v)}
          modeState={states["wa-default-mode"]}
          configured={configured}
          onConnect={() => setTab("conexion")}
        />
        <SettingsTabs tabs={TABS} value={tab} onChange={setTab} />
      </div>

      <div role="tabpanel" id={`wa-panel-${tab}`} aria-labelledby={`wa-tab-${tab}`} className="pb-10">
        {tab === "conexion" && <ConnectionTab provider={provider} />}
        {tab === "ia" && <AiTab />}
        {tab === "citas" && <BookingTab accounts={calendarAccounts} />}
        {tab === "avisos" && <AlertsTab welcome={welcome} setWelcome={setWelcome} configured={configured} />}
        {tab === "plantillas" && <TemplatesTab counts={templateCounts} />}
        {tab === "avanzado" && <AdvancedTab />}
      </div>
    </SettingsContext.Provider>
  );
};

export default WhatsAppSettingsClient;
