"use client";

import { Input } from "@/app/components/ui/input";
import { Textarea } from "@/app/components/ui/textarea";
import { TYPING_DELAY, useSettings } from "./context";
import SettingRow, { SettingsGroup } from "./SettingRow";
import ToggleRow from "./ToggleRow";

/**
 * La sesión urgente: a quien insiste en hablar con Dayana hoy (lo pidió, le
 * ofrecieron otros días y vuelve a pedirlo), la IA le manda el enlace de pago
 * de la sesión privada de 1 hora; Dayana la agenda en cuanto pague.
 */
const UrgentSessionSection = () => {
  const { config, change, states } = useSettings();
  const urgent = config.urgentSession;

  return (
    <SettingsGroup
      title="Sesión urgente"
      description="Para quien insiste en hablar contigo hoy: la IA le ofrece la sesión privada de 1 hora con el enlace de pago, y tú la agendas para hoy o mañana en cuanto pague."
    >
      <ToggleRow
        id="wa-urgent-session"
        label="Ofrecer la sesión urgente"
        help="Solo si de verdad insiste: lo pidió para hoy, le dijeron que hoy no hay espacio o le ofrecieron otros días, y vuelve a pedirlo («es que es rápido», «necesito hablar con ella ya»). A quien pregunta una vez se le ofrecen las horas de siempre."
        info="Te llega un aviso cuando se lo manda. Nunca dice el precio: lo ve en el enlace. No a quien ya es clienta o cliente, ni en una crisis (eso te lo pasa a ti)."
        state={states["wa-urgent-session"]}
        checked={urgent.enabled}
        onChange={(v) => change("wa-urgent-session", "urgentSession.enabled", v)}
      />
      <SettingRow
        id="wa-urgent-session-link"
        layout="stacked"
        label="Enlace de pago de la sesión"
        help="Una página del sitio, como /pagar/p/therapy-1 (la sesión privada de 1 hora), o un enlace completo."
        state={states["wa-urgent-session-link"]}
      >
        <Input
          aria-label="Enlace de pago de la sesión urgente"
          placeholder="/pagar/p/… o https://…"
          defaultValue={urgent.url}
          disabled={!urgent.enabled}
          onChange={(e) => {
            const url = e.target.value.trim();
            if (/^(https:\/\/|\/)\S+$/.test(url)) change("wa-urgent-session-link", "urgentSession.url", url.slice(0, 300), TYPING_DELAY);
          }}
        />
      </SettingRow>
      <SettingRow
        id="wa-urgent-session-after"
        layout="stacked"
        label="Lo que va debajo del enlace"
        help="El siguiente paso, tal cual."
        state={states["wa-urgent-session-after"]}
      >
        <Textarea
          aria-label="Texto debajo del enlace de la sesión urgente"
          defaultValue={urgent.afterPayment}
          rows={2}
          maxLength={300}
          disabled={!urgent.enabled}
          onChange={(e) => {
            const text = e.target.value.trim();
            if (text.length >= 10) change("wa-urgent-session-after", "urgentSession.afterPayment", text, TYPING_DELAY);
          }}
        />
      </SettingRow>
    </SettingsGroup>
  );
};

export default UrgentSessionSection;
