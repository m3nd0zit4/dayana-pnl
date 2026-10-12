"use client";

import { SEGMENT_LABEL, SEGMENTS, type Segment } from "@/lib/crm/whatsapp-agent/segment";
import ChoiceCards from "./ChoiceCards";
import { useSettings } from "./context";
import { NumberField } from "./fields";
import SettingRow, { SettingsGroup } from "./SettingRow";
import ToggleRow from "./ToggleRow";

type Mode = "AUTO" | "COPILOT" | "MANUAL";

const MODE_OPTIONS: { id: Mode; label: string; hint: string }[] = [
  { id: "AUTO", label: "IA", hint: "La IA contesta sola." },
  { id: "COPILOT", label: "Copiloto", hint: "La IA propone y tú apruebas." },
  { id: "MANUAL", label: "Tú", hint: "La IA no escribe; te aparece en «Te toca»." },
];

const SEGMENT_HELP: Record<Segment, string> = {
  new_lead: "Escribe por primera vez (aunque haya recibido invitaciones).",
  returning_lead: "Ya habló contigo o con la asistente, no consta que haya pagado.",
  free_call_booked: "Tiene agendada la llamada gratis.",
  client: "Ya pagó (en el CRM o por transferencia) o la marcaste como clienta.",
  ignored: "Personal, del equipo o una empresa/app.",
};

/**
 * Quién atiende a quién: el modo de cada chat según quién es la persona. El
 * modo general (arriba) sigue siendo el tope: con el general en Copiloto,
 * ninguna respuesta sale sola aunque aquí diga IA.
 */
const RouterSection = () => {
  const { config, change, states } = useSettings();
  const router = config.router;
  return (
    <SettingsGroup
      title="Quién atiende a quién"
      description="El modo de cada chat según quién es la persona. El modo general de arriba es el tope."
    >
      <ToggleRow
        id="wa-router"
        label="Decidir el modo por persona"
        help="Encendido, cada chat usa el modo de su grupo (abajo). Si eliges un modo en un chat, ese chat se queda con el tuyo."
        info="Apagado, todos los chats usan el modo general. Las clientas en «Tú» no reciben respuestas de la IA y te aparecen en «Te toca»; lo personal no aparece."
        state={states["wa-router"]}
        checked={router.enabled}
        onChange={(v) => change("wa-router", "router.enabled", v)}
      />
      {SEGMENTS.map((segment) => (
        <SettingRow
          key={segment}
          id={`wa-router-${segment}`}
          label={SEGMENT_LABEL[segment]}
          help={SEGMENT_HELP[segment]}
          state={states[`wa-router-${segment}`]}
          layout="row"
        >
          <ChoiceCards
            variant="segmented"
            ariaLabel={`Modo para ${SEGMENT_LABEL[segment]}`}
            value={router.modes[segment]}
            disabled={!router.enabled}
            onChange={(v) => change(`wa-router-${segment}`, `router.modes.${segment}`, v)}
            options={MODE_OPTIONS}
          />
        </SettingRow>
      ))}
      <SettingRow
        id="wa-router-max-new"
        label="Respuestas por día a una persona nueva"
        help="Hasta agendar la llamada hacen falta varias vueltas: saludo, cómo está, de dónde escribe, lo que le pasa, la invitación y las horas."
        state={states["wa-router-max-new"]}
        layout="row"
      >
        <NumberField
          value={router.maxPerDayNewLead}
          min={1}
          max={30}
          disabled={!router.enabled}
          onChange={(v) => change("wa-router-max-new", "router.maxPerDayNewLead", v, 600)}
        />
      </SettingRow>
    </SettingsGroup>
  );
};

export default RouterSection;
