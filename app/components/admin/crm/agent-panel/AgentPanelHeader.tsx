"use client";

import { useState, type ReactNode } from "react";
import { Check, ChevronDown, History, SquarePen, Trash2 } from "lucide-react";
import { AGENT_ORDER, AGENT_PROFILES, type AgentId } from "@/agent/lib/catalog";
import { newConversationLabel } from "@/lib/agent-ui/agents";
import { Button } from "@/app/components/ui/button";
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
import { DEFAULT_THREAD_TITLE, listThreads, type AgentThread } from "./thread-store";

type Props = {
  agent: AgentId;
  title: string;
  threadId: string;
  onNewThread: (agent: AgentId) => void;
  onSwitchThread: (thread: AgentThread) => void;
  onDeleteThread: (id: string) => void;
  /** Expand / close buttons, which differ between the desktop aside and the mobile sheet. */
  trailing?: ReactNode;
  /** Bigger hit areas in the mobile sheet. */
  touch?: boolean;
};

/**
 * The panel's header: who you're talking to (and a picker to start a
 * conversation with someone else), the history, and «new conversation».
 * Switching agent always opens a new thread: the server pins a session to
 * the agent it started with.
 */
export const AgentPanelHeader = ({
  agent,
  title,
  threadId,
  onNewThread,
  onSwitchThread,
  onDeleteThread,
  trailing,
  touch = false,
}: Props) => {
  const [threads, setThreads] = useState<AgentThread[]>([]);
  const profile = AGENT_PROFILES[agent];
  const Icon = AGENT_ICONS[agent];
  const iconButton = touch ? "size-8" : "size-7";

  return (
    <div className="flex min-w-0 flex-1 items-center gap-1">
      <DropdownMenu>
        <DropdownMenuTrigger
          data-testid="agent-picker-trigger"
          aria-label={`Agente: ${profile.label}. Cambiar de agente`}
          className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-1.5 py-1 text-left outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/50"
          render={<button type="button" />}
        >
          <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-muted text-foreground">
            <Icon className="size-4" />
          </span>
          <span className="flex min-w-0 flex-col">
            <span className="flex items-center gap-1 text-sm font-medium">
              <span className="truncate">{profile.label}</span>
              <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
            </span>
            <span className="truncate text-xs text-muted-foreground" data-testid="agent-thread-title">
              {title === DEFAULT_THREAD_TITLE ? profile.tagline : title}
            </span>
          </span>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-80 max-w-[calc(100vw-2rem)]" data-testid="agent-picker-menu">
          <DropdownMenuGroup>
            <DropdownMenuLabel>Nueva conversación con…</DropdownMenuLabel>
            {AGENT_ORDER.map((id) => {
              const OptionIcon = AGENT_ICONS[id];
              return (
                <DropdownMenuItem
                  key={id}
                  data-testid={`agent-picker-option-${id}`}
                  onClick={() => onNewThread(id)}
                  className="items-start gap-2.5 py-2"
                >
                  <OptionIcon className="mt-0.5 size-4 text-muted-foreground" />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="font-medium">{AGENT_PROFILES[id].label}</span>
                    <span className="text-xs text-muted-foreground">{AGENT_PROFILES[id].tagline}</span>
                  </span>
                  {id === agent && <Check className="mt-0.5 size-4" aria-label="Agente actual" />}
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>

      <DropdownMenu onOpenChange={(open) => open && setThreads(listThreads())}>
        <DropdownMenuTrigger
          data-testid="agent-threads-trigger"
          render={
            <Button variant="ghost" size="icon" className={cn(iconButton, "shrink-0")} aria-label="Conversaciones anteriores">
              <History className="size-4" />
            </Button>
          }
        />
        <DropdownMenuContent align="end" className="w-80 max-w-[calc(100vw-2rem)]" data-testid="agent-threads-menu">
          <DropdownMenuGroup>
            <DropdownMenuLabel>Conversaciones</DropdownMenuLabel>
            {threads.length === 0 && (
              <p className="px-1.5 py-1.5 text-xs text-muted-foreground">Sin conversaciones aún</p>
            )}
            {threads.map((t) => {
              const ThreadIcon = AGENT_ICONS[t.agent];
              return (
                <DropdownMenuItem
                  key={t.id}
                  onClick={() => onSwitchThread(t)}
                  data-current={t.id === threadId ? "true" : undefined}
                  className="gap-2 data-[current=true]:bg-muted"
                >
                  <ThreadIcon className="size-4 text-muted-foreground" />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate">{t.title}</span>
                    <span className="text-xs text-muted-foreground">{AGENT_PROFILES[t.agent].label}</span>
                  </span>
                  <button
                    type="button"
                    aria-label="Eliminar conversación"
                    title="Eliminar conversación"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDeleteThread(t.id);
                      setThreads(listThreads());
                    }}
                    className="shrink-0 rounded p-1 text-muted-foreground outline-none hover:text-destructive focus-visible:ring-2 focus-visible:ring-ring/50"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>

      <Button
        variant="ghost"
        size="icon"
        className={cn(iconButton, "shrink-0")}
        aria-label={newConversationLabel(agent)}
        title={newConversationLabel(agent)}
        data-testid="agent-new-thread"
        onClick={() => onNewThread(agent)}
      >
        <SquarePen className="size-4" />
      </Button>

      {trailing}
    </div>
  );
};
