"use client";

import { Bot, Hand, PenLine, Power } from "lucide-react";
import { cn } from "@/lib/utils";
import ChoiceCards from "./ChoiceCards";
import SaveIndicator, { type SaveState } from "./SaveIndicator";
import { InfoTip, SETTING_ANCHOR_CLASS } from "./SettingRow";
import { WaSwitch } from "./ToggleRow";

type Mode = "AUTO" | "COPILOT" | "MANUAL";

const MODE_HINT: Record<Mode, string> = {
  AUTO: "La IA responde sola.",
  COPILOT: "La IA deja borradores y tú los envías.",
  MANUAL: "La IA no escribe; respondes tú.",
};

/**
 * Los dos controles más importantes, siempre a la vista en todas las
 * pestañas: si la IA está encendida y cómo arrancan los chats nuevos.
 */
const AiMasterBar = ({
  enabled,
  onEnabled,
  enabledState,
  mode,
  onMode,
  modeState,
  configured,
  onConnect,
}: {
  enabled: boolean;
  onEnabled: (v: boolean) => void;
  enabledState?: SaveState;
  mode: Mode;
  onMode: (v: Mode) => void;
  modeState?: SaveState;
  configured: boolean;
  onConnect: () => void;
}) => (
  <div
    className={cn(
      "rounded-xl border bg-card p-3 shadow-sm transition-colors sm:p-4",
      enabled ? "border-[#00a884]/50" : "border-border"
    )}
  >
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div id="wa-ai-enabled" className={cn(SETTING_ANCHOR_CLASS, "flex items-center gap-3")}>
        <span
          aria-hidden
          className={cn(
            "flex size-9 shrink-0 items-center justify-center rounded-full",
            enabled ? "bg-[#00a884] text-white" : "bg-muted text-muted-foreground"
          )}
        >
          <Power className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2">
            <label htmlFor="wa-ai-enabled-switch" className="text-sm font-semibold">
              {enabled ? "IA encendida" : "IA apagada"}
            </label>
            <SaveIndicator state={enabledState} />
          </div>
          <p className="text-xs text-muted-foreground">
            {enabled ? "Contesta según los ajustes de abajo." : "No escribe en ningún chat."}
          </p>
        </div>
        <WaSwitch
          id="wa-ai-enabled-switch"
          checked={enabled}
          onCheckedChange={onEnabled}
        />
      </div>

      <div id="wa-default-mode" className={cn(SETTING_ANCHOR_CLASS, "space-y-1")}>
        <div className="flex flex-wrap items-center gap-x-2">
          <span className="text-xs font-medium text-muted-foreground">Chats nuevos</span>
          <InfoTip>
            Cómo arranca cada chat nuevo. Cada chat se puede cambiar aparte desde su cabecera, y para cambiar todos los
            chats a la vez está el selector de la bandeja.
          </InfoTip>
          <SaveIndicator state={modeState} />
        </div>
        <ChoiceCards<Mode>
          variant="segmented"
          ariaLabel="Modo de los chats nuevos"
          value={mode}
          onChange={onMode}
          options={[
            { id: "AUTO", label: "IA", icon: Bot, hint: MODE_HINT.AUTO },
            { id: "COPILOT", label: "Copiloto", icon: PenLine, hint: MODE_HINT.COPILOT },
            { id: "MANUAL", label: "Manual", icon: Hand, hint: MODE_HINT.MANUAL },
          ]}
        />
      </div>
    </div>
    {!configured && (
      <p className="mt-3 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs">
        WhatsApp aún no está conectado: la IA no puede escribir.{" "}
        <button type="button" onClick={onConnect} className="font-medium underline">
          Conectar
        </button>
      </p>
    )}
  </div>
);

export default AiMasterBar;
