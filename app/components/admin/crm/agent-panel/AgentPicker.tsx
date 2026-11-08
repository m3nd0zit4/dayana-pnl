"use client";

import { useSyncExternalStore, type ReactElement } from "react";
import { Check, ChevronDown } from "lucide-react";
import { AGENT_ORDER, AGENT_PROFILES, isAgentId, type AgentId } from "@/agent/lib/catalog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/app/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { AGENT_ICONS } from "./agent-icons";

/**
 * The list of agents, one place for every picker: the panel header, the
 * phone's floating pill and the composer of the phone sheet. Picking one
 * calls `onPick`; what that means (new thread, or the agent the next message
 * goes to) is the caller's.
 */
export const AgentPickerMenu = ({
  current,
  onPick,
  label = "Nueva conversación con…",
  testId = "agent-picker",
  side = "bottom",
  align = "start",
  touch = false,
}: {
  current: AgentId;
  onPick: (agent: AgentId) => void;
  label?: string;
  /** `<testId>-menu`, `<testId>-option-<id>`. */
  testId?: string;
  side?: "top" | "bottom";
  align?: "start" | "end";
  /** Taller rows on the phone. */
  touch?: boolean;
}) => (
  <DropdownMenuContent
    side={side}
    align={align}
    className="w-80 max-w-[calc(100vw-2rem)]"
    data-testid={`${testId}-menu`}
  >
    <DropdownMenuGroup>
      <DropdownMenuLabel>{label}</DropdownMenuLabel>
      {AGENT_ORDER.map((id) => {
        const OptionIcon = AGENT_ICONS[id];
        return (
          <DropdownMenuItem
            key={id}
            data-testid={`${testId}-option-${id}`}
            onClick={() => onPick(id)}
            className={cn("items-start gap-2.5 py-2", touch && "min-h-12 py-2.5")}
          >
            <OptionIcon className="mt-0.5 size-4 text-muted-foreground" />
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="font-medium">{AGENT_PROFILES[id].label}</span>
              <span className="text-xs text-muted-foreground">{AGENT_PROFILES[id].tagline}</span>
            </span>
            {id === current && <Check className="mt-0.5 size-4" aria-label="Agente actual" />}
          </DropdownMenuItem>
        );
      })}
    </DropdownMenuGroup>
  </DropdownMenuContent>
);

/**
 * Compact agent chip for the phone's composers (the floating pill and the
 * sheet): the agent's icon and a chevron, 40 px tall, opening the same list
 * as the header. The agent's name is in the box's placeholder
 * («Pregúntale a Ventas»), so the chip doesn't need to spell it.
 */
export const AgentChip = ({
  agent,
  onPick,
  label,
  testId,
  className,
}: {
  agent: AgentId;
  onPick: (agent: AgentId) => void;
  label?: string;
  testId: string;
  className?: string;
}) => {
  const Icon = AGENT_ICONS[agent];
  const trigger: ReactElement = (
    <button
      type="button"
      className={cn(
        "flex h-10 shrink-0 items-center gap-0.5 rounded-full pr-1.5 pl-1 text-foreground outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/50 data-popup-open:bg-accent",
        className,
      )}
    />
  );
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        data-testid={`${testId}-trigger`}
        data-agent={agent}
        aria-label={`Agente: ${AGENT_PROFILES[agent].label}. Cambiar de agente`}
        title={`Agente: ${AGENT_PROFILES[agent].label}`}
        render={trigger}
      >
        <span className="flex size-8 items-center justify-center rounded-full bg-muted">
          <Icon className="size-4" />
        </span>
        <ChevronDown className="size-3.5 text-muted-foreground" />
      </DropdownMenuTrigger>
      <AgentPickerMenu current={agent} onPick={onPick} label={label} testId={testId} side="top" touch />
    </DropdownMenu>
  );
};

/**
 * The phone composers' placeholder. Next to the chip there are ~100 px of box
 * at 375 px, so «Pregunta a Talleres y eventos» would be cut or wrap: it names
 * only the agent («Ventas…», «Pregunta…» for the assistant), next to the
 * agent's icon. The full «Pregúntale a Ventas» stays as the accessible name.
 */
export const shortAgentPlaceholder = (id: AgentId): string =>
  id === "auto" ? "Pregunta…" : `${AGENT_PROFILES[id].label}…`;

/**
 * The agent the phone pill sends to: the last one picked anywhere (pill or
 * panel), remembered on this device. Browser storage may be missing (private
 * window, blocked site data); then it is simply «Asistente».
 */
const CHOICE_KEY = "crm.agent.lastPicked";
const listeners = new Set<() => void>();
let memoryChoice: AgentId | null = null;

const readChoice = (): AgentId => {
  if (memoryChoice) return memoryChoice;
  try {
    const stored = window.localStorage.getItem(CHOICE_KEY);
    if (isAgentId(stored)) memoryChoice = stored;
  } catch {
    // No storage: keep the default.
  }
  return memoryChoice ?? "auto";
};

export const rememberAgentChoice = (agent: AgentId) => {
  memoryChoice = agent;
  try {
    window.localStorage.setItem(CHOICE_KEY, agent);
  } catch {
    // Remembered for this tab only.
  }
  listeners.forEach((l) => l());
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const useAgentChoice = (): AgentId =>
  useSyncExternalStore(subscribe, readChoice, () => "auto");
