/**
 * Copy that names an agent. Pure.
 */
import { AGENT_PROFILES, isAgentId, type AgentId } from "@/agent/lib/catalog";

/** «Asistente» is the router; everyone else is a specialist with their own name. */
export const agentLabel = (id: AgentId): string => AGENT_PROFILES[id].label;

/** Composer placeholder: «Pregúntale al asistente», «Pregúntale a Ventas». */
export const agentPlaceholder = (id: AgentId): string =>
  id === "auto" ? "Pregúntale al asistente" : `Pregúntale a ${AGENT_PROFILES[id].label}`;

/** «Nueva conversación con Ventas». */
export const newConversationLabel = (id: AgentId): string =>
  id === "auto" ? "Nueva conversación con el asistente" : `Nueva conversación con ${AGENT_PROFILES[id].label}`;

export const toAgentId = (value: unknown): AgentId => (isAgentId(value) ? value : "auto");
