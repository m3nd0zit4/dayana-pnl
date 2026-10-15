"use client";

import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import { TYPING_DELAY, useSettings } from "./context";
import SettingRow, { SettingsGroup } from "./SettingRow";
import ToggleRow, { WaSwitch } from "./ToggleRow";

/**
 * La comunidad gratis de WhatsApp y lo más económico: la asistente manda el
 * enlace cuando piden entrar al grupo o cuando no les alcanza para la terapia.
 * Los enlaces salen tal cual, debajo del mensaje (la IA nunca los escribe).
 */
const CommunitySection = () => {
  const { config, change, states } = useSettings();
  const community = config.community;
  const options = config.affordable.options;

  const setOptions = (next: typeof options, delay = 0) => change("wa-affordable-options", "affordable.options", next, delay);
  const setOption = (index: number, patch: Partial<(typeof options)[number]>, delay = 0) =>
    setOptions(
      options.map((o, i) => (i === index ? { ...o, ...patch } : o)),
      delay
    );
  const add = () =>
    setOptions([...options, { key: `opcion-${Date.now().toString(36)}`, label: "Nueva opción", url: "/cursos", enabled: false }]);

  return (
    <SettingsGroup
      title="Comunidad y opciones económicas"
      description="Lo que la asistente ofrece a quien pide entrar a la comunidad o dice que no le alcanza para la terapia."
    >
      <ToggleRow
        id="wa-community"
        label="Mandar el enlace de la comunidad"
        help="Si piden entrar a la comunidad o al grupo, la IA les manda el enlace para que entren (no te lo pasa a ti)."
        state={states["wa-community"]}
        checked={community.enabled}
        onChange={(v) => change("wa-community", "community.enabled", v)}
      />
      <SettingRow
        id="wa-community-link"
        layout="stacked"
        label="Enlace de la comunidad"
        help="El enlace de invitación del grupo o la comunidad de WhatsApp (https://chat.whatsapp.com/…)."
        state={states["wa-community-link"]}
      >
        <Input
          aria-label="Enlace de la comunidad"
          type="url"
          disabled={!community.enabled}
          defaultValue={community.url}
          onChange={(e) => {
            const url = e.target.value.trim();
            if (/^https:\/\/\S+$/.test(url)) change("wa-community-link", "community.url", url, TYPING_DELAY);
          }}
        />
      </SettingRow>
      <ToggleRow
        id="wa-affordable"
        label="Ofrecer algo más económico"
        help="Si dicen que no les alcanza o que primero van a ahorrar, la IA no insiste con la terapia: les ofrece la comunidad y estas opciones, sin decir precios."
        state={states["wa-affordable"]}
        checked={config.affordable.enabled}
        onChange={(v) => change("wa-affordable", "affordable.enabled", v)}
      />
      <SettingRow
        id="wa-affordable-options"
        layout="stacked"
        label="Opciones más económicas"
        help="Qué es (la IA lo usa para explicarlo, sin precio) y su enlace. Puede ser una página del sitio, como /pagar/p/course-live."
        state={states["wa-affordable-options"]}
      >
        <ul className="space-y-4">
          {options.map((o, i) => (
            <li key={o.key} className="space-y-2 rounded-xl border border-border p-3">
              <div className="flex items-center gap-2">
                <Input
                  aria-label="Qué es"
                  defaultValue={o.label}
                  className="flex-1"
                  disabled={!config.affordable.enabled}
                  onChange={(e) => {
                    const label = e.target.value.trim();
                    if (label.length >= 2) setOption(i, { label: label.slice(0, 160) }, TYPING_DELAY);
                  }}
                />
                <WaSwitch aria-label={`Ofrecer ${o.label}`} checked={o.enabled} onCheckedChange={(v) => setOption(i, { enabled: v })} />
                <Button variant="ghost" size="icon" aria-label={`Quitar ${o.label}`} onClick={() => setOptions(options.filter((_, j) => j !== i))}>
                  <Trash2 className="size-4" />
                </Button>
              </div>
              <Input
                aria-label="Enlace"
                placeholder="/pagar/p/… o https://…"
                defaultValue={o.url}
                disabled={!config.affordable.enabled}
                onChange={(e) => {
                  const url = e.target.value.trim();
                  if (/^(https:\/\/|\/)\S+$/.test(url)) setOption(i, { url: url.slice(0, 300) }, TYPING_DELAY);
                }}
              />
            </li>
          ))}
        </ul>
        {options.length < 4 && (
          <Button variant="outline" size="sm" className="mt-3" onClick={add}>
            <Plus className="size-4" /> Agregar opción
          </Button>
        )}
      </SettingRow>
    </SettingsGroup>
  );
};

export default CommunitySection;
