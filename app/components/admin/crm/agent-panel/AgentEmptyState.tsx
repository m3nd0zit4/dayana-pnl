"use client";

import { AGENT_PROFILES, type AgentId } from "@/agent/lib/catalog";
import { AGENT_ICONS } from "./agent-icons";

/** A fresh conversation: who this agent is and three things to ask it. A chip sends right away. */
export const AgentEmptyState = ({
  agent,
  disabled,
  onSuggestion,
}: {
  agent: AgentId;
  disabled?: boolean;
  onSuggestion: (text: string) => void;
}) => {
  const profile = AGENT_PROFILES[agent];
  const Icon = AGENT_ICONS[agent];

  return (
    <div
      data-testid="agent-empty-state"
      data-agent={agent}
      className="flex flex-1 flex-col items-center justify-center gap-4 overflow-y-auto px-5 py-8 text-center"
    >
      <span className="flex size-12 items-center justify-center rounded-xl bg-muted text-foreground">
        <Icon className="size-6" />
      </span>
      <div className="space-y-1">
        <h2 className="font-heading text-base font-medium text-foreground">{profile.label}</h2>
        <p className="mx-auto max-w-xs text-sm text-muted-foreground">{profile.tagline}</p>
      </div>
      <div className="flex w-full max-w-sm flex-col gap-2">
        {profile.suggestions.slice(0, 3).map((suggestion) => (
          <button
            key={suggestion}
            type="button"
            data-testid="agent-suggestion"
            disabled={disabled}
            onClick={() => onSuggestion(suggestion)}
            className="rounded-lg border border-border bg-card px-3 py-2 text-left text-sm text-foreground outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50"
          >
            {suggestion}
          </button>
        ))}
      </div>
    </div>
  );
};
