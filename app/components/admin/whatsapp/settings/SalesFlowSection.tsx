"use client";

import { Textarea } from "@/app/components/ui/textarea";
import { TYPING_DELAY, useSettings } from "./context";
import { NumberField } from "./fields";
import SettingRow, { SettingsGroup } from "./SettingRow";
import ToggleRow, { WaSwitch } from "./ToggleRow";

/**
 * Primera vez: la asistente saluda, pregunta cómo está y de dónde escribe,
 * escucha, hace la pregunta clave según lo que mueve a la persona e invita a
 * la llamada gratis con horas reales. Aquí Dayana edita las preguntas clave y
 * decide si la asistente agenda sola.
 */
const SalesFlowSection = () => {
  const { config, change, states } = useSettings();
  const flow = config.salesFlow;
  const free = config.freeCall;
  const buttons = flow.buyButtons;

  const setButton = (index: number, patch: Partial<(typeof buttons)[number]>, delay = 0) =>
    change(
      "wa-sales-buttons",
      "salesFlow.buyButtons",
      buttons.map((b, i) => (i === index ? { ...b, ...patch } : b)),
      delay
    );

  return (
    <SettingsGroup
      title="Primera vez: llevar a la llamada gratis"
      description="Saludo como tu asistente, cómo está, de dónde escribe, lo que le pasa, la pregunta clave y la invitación a la llamada gratis de 15 minutos."
    >
      <ToggleRow
        id="wa-sales-flow"
        label="Seguir el flujo de primera vez"
        help="Con horas reales de tu calendario, en la hora de la persona y la de Colombia. Nunca da precios."
        info="Lo que mueve a la persona (tristeza, ansiedad…) es interno: la IA nunca se lo nombra. Lo emocional no se te pasa como «clínico»: solo una crisis o un riesgo."
        state={states["wa-sales-flow"]}
        checked={flow.enabled}
        onChange={(v) => change("wa-sales-flow", "salesFlow.enabled", v)}
      />
      <ToggleRow
        id="wa-free-autobook"
        label="Agendar la llamada gratis sola"
        help="Sin esperar tu aprobación. Solo a personas nuevas o que ya conversaron, con «Quién atiende a quién» encendido y en modo IA. Te llega el aviso."
        info="Apagado (o en copiloto), la cita queda para que la apruebes. Las sesiones pagadas siempre esperan tu aprobación."
        state={states["wa-free-autobook"]}
        checked={free.autoBook}
        disabled={!flow.enabled}
        onChange={(v) => change("wa-free-autobook", "freeCall.autoBook", v)}
      />
      <SettingRow
        id="wa-free-max"
        label="Llamadas gratis por día"
        help="Como mucho; al llegar al tope, ofrece otro día."
        state={states["wa-free-max"]}
        layout="row"
      >
        <NumberField value={free.maxPerDay} min={1} max={20} onChange={(v) => change("wa-free-max", "freeCall.maxPerDay", v, 600)} />
      </SettingRow>
      <ToggleRow
        id="wa-waiting-room"
        label="Sala de espera de la llamada gratis"
        help="Si escribe a la hora de su llamada y sigues en otra reunión: «Dayana está terminando una reunión, por favor espérala unos 5 minutos». Te suena el aviso."
        info="Solo para la llamada gratis, como mucho dos veces por cita. Se mira en tu calendario: si algo cruza ese momento o acaba de terminar. Si no estás ocupada y ya es la hora: «ya le aviso a Dayana»."
        state={states["wa-waiting-room"]}
        checked={config.waitingRoom.enabled}
        onChange={(v) => change("wa-waiting-room", "waitingRoom.enabled", v)}
      />
      <ToggleRow
        id="wa-waiting-proactive"
        label="Avisarle aunque no escriba"
        help="Cada 10 minutos el reloj revisa: si ya es su hora y sigues ocupada, se lo dice sin esperar a que escriba (solo si escribió en las últimas 24 h)."
        state={states["wa-waiting-proactive"]}
        checked={config.waitingRoom.proactive}
        disabled={!config.waitingRoom.enabled}
        onChange={(v) => change("wa-waiting-proactive", "waitingRoom.proactive", v)}
      />
      <ToggleRow
        id="wa-call-followup"
        label="Saber si se hizo la llamada y reagendar si no contestó"
        help="Al terminar cada llamada gratis se lee el chat; si no queda claro, la asistente le pregunta «¿Pudiste hablar con Dayana?». Si no contestó (o no responde en 24 h), le manda 2–3 horas libres para reagendar."
        info="WhatsApp no avisa de las llamadas que haces desde el celular: por eso se deduce del chat («no me llamaron», «fue un gusto hablar contigo», un pago…) o de su respuesta. Lo ves en la Agenda. Fuera de las 24 h usa las plantillas «Llamada gratis: ¿pudiste hablar?» y «Llamada gratis: no contestó» (apruébalas en Plantillas)."
        state={states["wa-call-followup"]}
        checked={config.callFollowUp.enabled}
        onChange={(v) => change("wa-call-followup", "callFollowUp.enabled", v)}
      />
      <ToggleRow
        id="wa-quote-followup"
        label="Seguimiento a quien ya recibió cómo pagar"
        help={`Cuando le mandas a alguien el enlace, la cuenta o el valor y no paga, la asistente le escribe para iniciar su proceso: a los ${config.quoteFollowUp.firstAfterDays} días (o el día después de la fecha que dijo, «la otra semana», «fin de mes») y otra vez a los ${config.quoteFollowUp.secondAfterDays} días. Como mucho ${config.quoteFollowUp.max}; si le escribes tú, espera.`}
        info="Lo ves en el chat, en «Seguimiento del cierre». No le escribe si la tienes en favoritos, tomaste el chat, está en pausa, mandó un comprobante o dice que ya pagó o que no quiere. Fuera de las 24 h usa la plantilla «Seguimiento: iniciar el proceso» (se manda sola a aprobar)."
        state={states["wa-quote-followup"]}
        checked={config.quoteFollowUp.enabled}
        onChange={(v) => change("wa-quote-followup", "quoteFollowUp.enabled", v)}
      />
      <SettingRow
        id="wa-call-followup-hours"
        label="Horas sin respuesta para darla por no contestada"
        state={states["wa-call-followup-hours"]}
        layout="row"
      >
        <NumberField
          value={config.callFollowUp.assumeMissedAfterHours}
          min={2}
          max={72}
          disabled={!config.callFollowUp.enabled}
          onChange={(v) => change("wa-call-followup-hours", "callFollowUp.assumeMissedAfterHours", v, 600)}
        />
      </SettingRow>
      <SettingRow
        id="wa-sales-buttons"
        layout="stacked"
        label="Preguntas clave"
        help="Según lo que la persona cuenta, la IA hace esta pregunta (una sola vez) antes de invitarla a la llamada."
        state={states["wa-sales-buttons"]}
      >
        <ul className="space-y-3">
          {buttons.map((b, i) => (
            <li key={b.key} className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium">{b.label}</span>
                <WaSwitch
                  aria-label={`Usar la pregunta de ${b.label}`}
                  checked={b.enabled}
                  onCheckedChange={(v) => setButton(i, { enabled: v })}
                />
              </div>
              <Textarea
                defaultValue={b.keyQuestion}
                rows={2}
                disabled={!b.enabled}
                onChange={(e) => {
                  const keyQuestion = e.target.value.trim();
                  if (keyQuestion.length >= 5) setButton(i, { keyQuestion }, TYPING_DELAY);
                }}
              />
            </li>
          ))}
        </ul>
      </SettingRow>
    </SettingsGroup>
  );
};

export default SalesFlowSection;
