"use client";

import { Input } from "@/app/components/ui/input";
import { Textarea } from "@/app/components/ui/textarea";
import PushToggle from "../PushToggle";
import ChoiceCards from "./ChoiceCards";
import { TYPING_DELAY, useSettings } from "./context";
import SettingRow, { SettingAnchor, SettingsGroup } from "./SettingRow";
import ToggleRow from "./ToggleRow";

export type WelcomeConfigDto = {
  isActive: boolean;
  text: string;
  buttonLabel: string;
  buttonUrl: string;
};

const WELCOME_API = "/api/admin/settings/whatsapp-welcome";

/** Lo mismo que valida el servidor, dicho antes de mandar. */
const welcomeProblem = (w: WelcomeConfigDto): { key: string; error: string } | null => {
  const text = w.text.trim();
  if (text.length < 5) return { key: "wa-welcome-text", error: "Escribe al menos 5 caracteres." };
  if (text.length > 900) return { key: "wa-welcome-text", error: "Máximo 900 caracteres." };
  const label = w.buttonLabel.trim();
  const url = w.buttonUrl.trim();
  if (url && !/^https:\/\//i.test(url)) return { key: "wa-welcome-button", error: "El enlace debe empezar por https://" };
  if (Boolean(label) !== Boolean(url)) {
    return { key: "wa-welcome-button", error: "Pon el texto y el enlace del botón, o deja los dos vacíos." };
  }
  return null;
};

type Outreach = "auto" | "approval" | "off";

/** Pestaña «Avisos»: qué te avisa a ti y qué le escribe la IA a la gente sola. */
const AlertsTab = ({
  welcome,
  setWelcome,
  configured,
}: {
  welcome: WelcomeConfigDto;
  setWelcome: (w: WelcomeConfigDto) => void;
  configured: boolean;
}) => {
  const { config, change, states, save, fail } = useSettings();
  const o = config.diagnosticOutreach;
  const outreach: Outreach = !o.enabled ? "off" : o.requireApproval ? "approval" : "auto";

  const updateWelcome = (key: string, next: WelcomeConfigDto, delay: number) => {
    setWelcome(next);
    const problem = welcomeProblem(next);
    if (problem) {
      fail(problem.key, problem.error);
      return;
    }
    // Un error viejo en el otro campo ya no aplica: el saludo entero es válido.
    for (const other of ["wa-welcome-text", "wa-welcome-button"]) {
      if (other !== key && states[other]?.status === "error") save(other, WELCOME_API, next, 0, false);
    }
    save(key, WELCOME_API, next, delay, false);
  };

  return (
    <div className="space-y-6">
      <SettingsGroup title="Avisos para ti">
        <SettingAnchor id="wa-push" className="p-1">
          <PushToggle embedded />
        </SettingAnchor>
        <SettingRow
          id="wa-notify"
          layout="stacked"
          label="Cuando la IA te pasa un chat, avisar a"
          state={states["wa-notify"]}
        >
          <ChoiceCards
            ariaLabel="A quién avisar"
            value={config.notify}
            onChange={(v) => change("wa-notify", "notify", v)}
            options={[
              { id: "ALL", label: "Todo el equipo", hint: "Según las notificaciones de cada persona." },
              { id: "OWNERS", label: "Solo a mí", hint: "Solo las cuentas de dueña." },
            ]}
          />
        </SettingRow>
      </SettingsGroup>

      <SettingsGroup title="Mensajes que la IA envía sola">
        <SettingRow
          id="wa-outreach"
          layout="stacked"
          label="Cuando alguien termina la autoevaluación"
          info="La IA lee sus respuestas, su país y su hora, y le escribe con tu estilo. Si la lectura sale urgente (p. ej. un duelo contestado de madrugada), te llega un aviso urgente y ese chat lo llevas tú."
          state={states["wa-outreach"]}
        >
          <ChoiceCards<Outreach>
            columns={3}
            ariaLabel="Autoevaluación"
            value={outreach}
            onChange={(v) =>
              change("wa-outreach", "diagnosticOutreach", { enabled: v !== "off", requireApproval: v === "approval" })
            }
            options={[
              { id: "auto", label: "Le escribe enseguida", hint: "Sin esperar tu aprobación." },
              { id: "approval", label: "Tú lo apruebas", hint: "Queda en la barra de aprobación del chat." },
              { id: "off", label: "No escribirle", hint: "Solo queda en Diagnósticos." },
            ]}
          />
        </SettingRow>
        <ToggleRow
          id="wa-welcome"
          label="Saludo a quien escribe por primera vez"
          help={
            configured
              ? "Texto fijo que escribes tú; se envía una sola vez por persona."
              : "Falta conectar WhatsApp: no se envía aunque lo enciendas."
          }
          state={states["wa-welcome"]}
          checked={welcome.isActive}
          onChange={(v) => updateWelcome("wa-welcome", { ...welcome, isActive: v }, 0)}
        />
        {welcome.isActive && (
          <>
            <SettingRow
              id="wa-welcome-text"
              htmlFor="wa-welcome-text-input"
              layout="stacked"
              label="Mensaje del saludo"
              state={states["wa-welcome-text"]}
            >
              <Textarea
                id="wa-welcome-text-input"
                rows={3}
                maxLength={900}
                value={welcome.text}
                aria-invalid={states["wa-welcome-text"]?.status === "error" || undefined}
                onChange={(e) => updateWelcome("wa-welcome-text", { ...welcome, text: e.target.value }, TYPING_DELAY)}
              />
            </SettingRow>
            <SettingRow
              id="wa-welcome-button"
              layout="stacked"
              label="Botón (opcional)"
              help="Abre tu página de citas dentro de WhatsApp. Máximo 20 caracteres."
              state={states["wa-welcome-button"]}
            >
              <div className="grid gap-2 sm:grid-cols-[12rem_1fr]">
                <Input
                  aria-label="Texto del botón"
                  maxLength={20}
                  value={welcome.buttonLabel}
                  placeholder="Agendar mi cita"
                  onChange={(e) =>
                    updateWelcome("wa-welcome-button", { ...welcome, buttonLabel: e.target.value }, TYPING_DELAY)
                  }
                />
                <Input
                  aria-label="Enlace del botón"
                  type="url"
                  inputMode="url"
                  value={welcome.buttonUrl}
                  placeholder="https://calendar.app.google/tu-enlace"
                  aria-invalid={states["wa-welcome-button"]?.status === "error" || undefined}
                  onChange={(e) =>
                    updateWelcome("wa-welcome-button", { ...welcome, buttonUrl: e.target.value.trim() }, TYPING_DELAY)
                  }
                />
              </div>
            </SettingRow>
          </>
        )}
      </SettingsGroup>
    </div>
  );
};

export default AlertsTab;
