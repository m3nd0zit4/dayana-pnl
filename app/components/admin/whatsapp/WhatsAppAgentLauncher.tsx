"use client";

import { Sparkles } from "lucide-react";
import { useEffect } from "react";
import { Button } from "@/app/components/ui/button";
import CrmPageShell from "../crm/CrmPageShell";
import { useCrm } from "../crm/CrmProvider";
import WhatsAppAssistantClient from "./WhatsAppAssistantClient";

const SUGGESTIONS = [
  "¿Cómo le fue hoy a la IA de WhatsApp?",
  "¿Qué chats de WhatsApp me tocan a mí?",
  "Las llamadas de valoración duran 30 minutos",
  "Que la IA no agende los viernes",
  "¿Qué le contestaría la IA a alguien que pregunta si atiendo parejas?",
  "Cuando pregunten el precio, que primero pregunte qué está viviendo",
];

/**
 * «Hablar con la IA» usa el panel del asistente del CRM (hilos, voz, adjuntos
 * y botones de aprobar) con el especialista de WhatsApp: abre una
 * conversación con él, o deja la abierta si ya es suya. Si el asistente del
 * CRM está apagado, queda el chat propio de la sección.
 */
const WhatsAppAgentLauncher = () => {
  const { agentEnabled, askAgent, startAgentConversation, setAgentPanelExpanded } = useCrm();

  useEffect(() => {
    if (!agentEnabled) return;
    startAgentConversation("whatsapp", { keepIfSame: true });
    setAgentPanelExpanded(true);
  }, [agentEnabled, startAgentConversation, setAgentPanelExpanded]);

  if (!agentEnabled) return <WhatsAppAssistantClient />;

  return (
    <CrmPageShell>
      <div className="space-y-4 pt-6 text-center">
        <Sparkles className="mx-auto size-8 text-[#128c4a]" />
        <h1 className="text-xl font-semibold">Hablar con la IA de WhatsApp</h1>
        <p className="mx-auto max-w-lg text-sm text-muted-foreground">
          Es el especialista de WhatsApp del asistente del CRM. Pregúntale cómo va WhatsApp,
          enséñale reglas o pídele cambios; cada cambio te pide aprobación antes de aplicarse.
        </p>
        <div className="flex flex-wrap justify-center gap-2">
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => {
                setAgentPanelExpanded(true);
                askAgent(s, undefined, { agent: "whatsapp" });
              }}
              className="rounded-full border border-border px-3 py-1.5 text-xs hover:bg-muted"
            >
              {s}
            </button>
          ))}
        </div>
        <Button
          onClick={() => {
            startAgentConversation("whatsapp", { keepIfSame: true });
            setAgentPanelExpanded(true);
          }}
          className="bg-[#128c4a] hover:bg-[#0f7a40]"
        >
          <Sparkles /> Abrir el asistente
        </Button>
      </div>
    </CrmPageShell>
  );
};

export default WhatsAppAgentLauncher;
