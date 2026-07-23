"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { UserContent } from "ai";
import { useEveAgent } from "eve/react";
import {
  ChevronDown,
  ChevronsLeftRight,
  Lightbulb,
  Paperclip,
  Send,
  SquarePen,
  Sparkles,
  UserRound,
  X,
} from "lucide-react";
import { Button } from "@/app/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/app/components/ui/dropdown-menu";
import { useCrm } from "@/app/components/admin/crm/CrmProvider";
import AgentMessage from "./AgentMessage";
import { Conversation, ConversationContent, ConversationScrollButton } from "./ai-elements/conversation";
import {
  PromptInput,
  PromptInputActionAddAttachments,
  PromptInputActionMenu,
  PromptInputActionMenuContent,
  PromptInputActionMenuTrigger,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
  type PromptInputMessage,
} from "./ai-elements/prompt-input";
import { deriveTitle, getThread, listThreads, upsertThread, type AgentThread } from "./thread-store";

const newThreadId = () => crypto.randomUUID();

const SKILLS = [
  {
    id: "stale-checkout-review",
    name: "Revisión de checkouts vencidos",
    prompt: "Revisa los checkouts pendientes de pago y resume cuáles necesitan atención.",
  },
  {
    id: "contact-dedupe-check",
    name: "Detección de contactos duplicados",
    prompt: "Busca contactos que puedan estar duplicados y compáralos.",
  },
  {
    id: "therapy-schedule-audit",
    name: "Auditoría de agenda de terapia",
    prompt: "Revisa los paquetes de terapia activos y encuentra sesiones sin agendar o vencidas.",
  },
] as const;

type ContactHit = { id: string; firstName: string; lastName: string | null; phoneE164: string };

type SubPanel = "mention" | "skills" | null;

/**
 * Root "+" menu content — just three items. Selecting Mención/Skills closes
 * this menu normally (default `closeOnClick`) and opens a SEPARATE, plain
 * `Popover` (see `SubPanelContent` below) rather than swapping this same
 * menu's content in place. Base UI `Menu.Item` has a documented "press +
 * drag to item + release" gesture path that force-closes the menu and
 * ignores `closeOnClick={false}` once a mousedown on the trigger goes
 * unresolved past ~200ms — exactly what an internal mode-swap triggers, since
 * replacing the item list mid-interaction can leave that gesture "armed".
 * Two independent, non-nested popups sidesteps it entirely.
 */
const RootMenuContent = ({ onSelect }: { onSelect: (panel: NonNullable<SubPanel>) => void }) => (
  <>
    <PromptInputActionAddAttachments label="Archivos" />
    <DropdownMenuItem onClick={() => onSelect("mention")}>
      <UserRound className="mr-2 size-4" /> Mención
    </DropdownMenuItem>
    <DropdownMenuItem onClick={() => onSelect("skills")}>
      <Lightbulb className="mr-2 size-4" /> Skills
    </DropdownMenuItem>
  </>
);

const SubPanelContent = ({
  panel,
  onInsertText,
}: {
  panel: NonNullable<SubPanel>;
  onInsertText: (text: string) => void;
}) => {
  const [query, setQuery] = useState("");
  const [contacts, setContacts] = useState<ContactHit[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (panel !== "mention") return;
    const t = setTimeout(() => {
      setLoading(true);
      const params = new URLSearchParams();
      if (query.trim()) params.set("q", query.trim());
      params.set("limit", "8");
      fetch(`/api/admin/contacts/search?${params}`)
        .then((r) => r.json() as Promise<{ contacts?: ContactHit[] }>)
        .then((data) => setContacts(data.contacts ?? []))
        .catch(() => setContacts([]))
        .finally(() => setLoading(false));
    }, 300);
    return () => clearTimeout(t);
  }, [panel, query]);

  if (panel === "skills") {
    return (
      <div className="flex flex-col gap-0.5">
        {SKILLS.map((skill) => (
          <button
            key={skill.id}
            type="button"
            className="flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent"
            onClick={() => onInsertText(skill.prompt)}
          >
            <Lightbulb className="size-4 shrink-0" />
            {skill.name}
          </button>
        ))}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      <input
        autoFocus
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Buscar contacto…"
        className="w-full rounded-md border border-input bg-transparent px-2 py-1 text-sm outline-none focus-visible:border-ring"
      />
      {loading && <p className="px-2 py-1 text-xs text-muted-foreground">Buscando…</p>}
      {!loading && contacts.length === 0 && (
        <p className="px-2 py-1 text-xs text-muted-foreground">Sin resultados</p>
      )}
      {contacts.map((c) => (
        <button
          key={c.id}
          type="button"
          className="flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent"
          onClick={() => onInsertText(`contacto "${`${c.firstName} ${c.lastName ?? ""}`.trim()}" (id: ${c.id})`)}
        >
          <UserRound className="size-4 shrink-0" />
          <span className="min-w-0 flex-1 truncate">
            {c.firstName} {c.lastName ?? ""}
          </span>
          <span className="font-mono text-xs text-muted-foreground">{c.phoneE164}</span>
        </button>
      ))}
    </div>
  );
};

const AgentPanelSession = ({
  threadId,
  seedMessage,
  onTitleChange,
}: {
  threadId: string;
  seedMessage?: string;
  onTitleChange: (title: string) => void;
}) => {
  const existing = useMemo(() => getThread(threadId), [threadId]);
  const titleRef = useRef(existing?.title ?? "Nueva conversación");
  const [input, setInput] = useState("");
  const [subPanel, setSubPanel] = useState<SubPanel>(null);
  const subPanelRef = useRef<HTMLDivElement>(null);
  const sentSeedRef = useRef(false);

  useEffect(() => {
    if (!subPanel) return;
    const onPointerDown = (e: PointerEvent) => {
      if (subPanelRef.current && !subPanelRef.current.contains(e.target as Node)) {
        setSubPanel(null);
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [subPanel]);

  const agent = useEveAgent({
    initialEvents: existing?.events ?? [],
    initialSession: existing?.session,
    onFinish: (snapshot) => {
      const firstUserText = snapshot.data.messages
        .find((m) => m.role === "user")
        ?.parts.find((p) => p.type === "text")?.text;
      if (firstUserText && titleRef.current === "Nueva conversación") {
        titleRef.current = deriveTitle(firstUserText);
        onTitleChange(titleRef.current);
      }
      upsertThread(threadId, {
        title: titleRef.current,
        session: snapshot.session,
        events: snapshot.events,
      });
    },
  });

  const isBusy = agent.status === "submitted" || agent.status === "streaming";

  useEffect(() => {
    if (sentSeedRef.current || !seedMessage) return;
    sentSeedRef.current = true;
    void agent.send({ message: seedMessage });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seedMessage]);

  const handleSubmit = async (message: PromptInputMessage) => {
    const text = message.text.trim();
    if ((text.length === 0 && message.files.length === 0) || isBusy) return;

    // PromptInputTextarea is controlled (`value={input}`), so PromptInput's
    // own `form.reset()` after submit only resets the uncontrolled DOM value
    // — the next render immediately overwrites it back to `input` state,
    // which is why the box kept showing the sent text. Clear it ourselves.
    setInput("");

    if (message.files.length === 0) {
      await agent.send({ message: text });
      return;
    }

    const parts: UserContent = [];
    if (text.length > 0) parts.push({ type: "text", text });
    for (const file of message.files) {
      parts.push({ type: "file", data: file.url ?? "", filename: file.filename, mediaType: file.mediaType });
    }
    await agent.send({ message: parts });
  };

  const handleRespond = (requestId: string, optionId: string) => {
    void agent.send({ inputResponses: [{ requestId, optionId }] });
  };

  const insertText = (text: string) => {
    setInput((prev) => (prev ? `${prev} ${text}` : text));
    setSubPanel(null);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {agent.data.messages.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 px-4 text-center text-sm text-muted-foreground">
          <Sparkles className="size-5" />
          Pregúntame sobre contactos, inscripciones o sesiones de terapia.
        </div>
      ) : (
        <Conversation className="min-h-0 flex-1">
          <ConversationContent className="mx-auto w-full max-w-3xl gap-6">
            {agent.data.messages.map((message, index) => (
              <AgentMessage
                key={message.id}
                message={message}
                canRespond={!isBusy}
                isStreaming={agent.status === "streaming" && index === agent.data.messages.length - 1}
                onRespond={handleRespond}
              />
            ))}
          </ConversationContent>
          <ConversationScrollButton />
        </Conversation>
      )}

      {agent.status === "error" && agent.error && (
        <p className="shrink-0 px-3 pb-1 text-xs text-destructive">{agent.error.message}</p>
      )}

      <div className="relative shrink-0 p-2.5">
        {subPanel && (
          <div
            ref={subPanelRef}
            className="absolute bottom-full left-2.5 z-10 mb-2 w-72 rounded-lg border border-border bg-popover p-2 text-popover-foreground shadow-md ring-1 ring-foreground/10"
          >
            <SubPanelContent panel={subPanel} onInsertText={insertText} />
          </div>
        )}
        <PromptInput
          onSubmit={(message) => void handleSubmit(message)}
          onError={(err) => console.error(err)}
        >
          <PromptInputTextarea disabled={isBusy} value={input} onChange={(e) => setInput(e.target.value)} />
          <PromptInputFooter>
            <PromptInputTools>
              <PromptInputActionMenu>
                <PromptInputActionMenuTrigger tooltip="Adjuntar / mencionar / skills">
                  <Paperclip className="size-4" />
                </PromptInputActionMenuTrigger>
                <PromptInputActionMenuContent>
                  <RootMenuContent onSelect={setSubPanel} />
                </PromptInputActionMenuContent>
              </PromptInputActionMenu>
            </PromptInputTools>
            <PromptInputSubmit status={agent.status} onStop={agent.stop} disabled={isBusy || !input.trim()}>
              <Send className="size-4" />
            </PromptInputSubmit>
          </PromptInputFooter>
        </PromptInput>
      </div>
    </div>
  );
};

const AgentPanel = () => {
  const {
    agentPanelOpen,
    setAgentPanelOpen,
    agentPanelExpanded,
    setAgentPanelExpanded,
    pendingAgentAction,
    clearPendingAgentAction,
  } = useCrm();
  const [threadId, setThreadId] = useState<string>(() => newThreadId());
  const [title, setTitle] = useState("Nueva conversación");
  const [threads, setThreads] = useState<AgentThread[]>([]);
  const [seed, setSeed] = useState<string | undefined>(undefined);
  // Tracks the last pendingAgentAction object already applied — comparing it
  // against the current one from CrmProvider lets us adjust local state
  // directly during render (React's documented pattern for "adjust state
  // when a prop changes"), same technique ContactFormModal.tsx already uses
  // for its own open/wasOpen tracking, and avoids the multi-branch setState
  // sequence tripping react-hooks/set-state-in-effect inside a useEffect.
  const [lastAppliedAction, setLastAppliedAction] = useState<typeof pendingAgentAction>(null);

  if (agentPanelOpen && pendingAgentAction && pendingAgentAction !== lastAppliedAction) {
    setLastAppliedAction(pendingAgentAction);
    if (pendingAgentAction.type === "message") {
      setThreadId(newThreadId());
      setTitle("Nueva conversación");
      setSeed(pendingAgentAction.value);
    } else {
      setThreadId(pendingAgentAction.value);
      setTitle(getThread(pendingAgentAction.value)?.title ?? "Conversación");
      setSeed(undefined);
    }
    clearPendingAgentAction();
  }

  if (!agentPanelOpen) return null;

  const startNewThread = () => {
    setThreadId(newThreadId());
    setTitle("Nueva conversación");
    setSeed(undefined);
  };

  const switchThread = (thread: AgentThread) => {
    setThreadId(thread.id);
    setTitle(thread.title);
    setSeed(undefined);
  };

  return (
    <aside
      className={`sticky top-0 flex h-svh min-h-0 shrink-0 flex-col border-l border-border bg-popover text-popover-foreground transition-[width] duration-200 ${
        agentPanelExpanded ? "w-[min(56rem,calc(100%-26rem))]" : "w-96"
      }`}
    >
      <header className="flex shrink-0 items-center gap-1 border-b border-border px-2 py-2">
        <DropdownMenu onOpenChange={(open) => open && setThreads(listThreads())}>
          <DropdownMenuTrigger
            className="flex min-w-0 flex-1 items-center gap-1 rounded-md px-1.5 py-1 text-sm font-medium hover:bg-accent"
            render={<button type="button" />}
          >
            <span className="min-w-0 truncate">{title}</span>
            <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {threads.length === 0 && (
              <p className="px-2 py-1.5 text-xs text-muted-foreground">Sin conversaciones aún</p>
            )}
            {threads.map((t) => (
              <DropdownMenuItem key={t.id} onClick={() => switchThread(t)}>
                <span className="truncate">{t.title}</span>
              </DropdownMenuItem>
            ))}
            {threads.length > 0 && <DropdownMenuSeparator />}
            <DropdownMenuItem onClick={startNewThread}>Nueva conversación</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <Button variant="ghost" size="icon" className="size-7 shrink-0" aria-label="Nueva conversación" onClick={startNewThread}>
          <SquarePen className="size-4" />
        </Button>

        <Button
          variant="ghost"
          size="icon"
          className="size-7 shrink-0"
          aria-label={agentPanelExpanded ? "Contraer" : "Expandir"}
          onClick={() => setAgentPanelExpanded(!agentPanelExpanded)}
        >
          <ChevronsLeftRight className="size-4" />
        </Button>

        <Button
          variant="ghost"
          size="icon"
          className="size-7 shrink-0"
          aria-label="Cerrar"
          onClick={() => setAgentPanelOpen(false)}
        >
          <X className="size-4" />
        </Button>
      </header>

      <AgentPanelSession key={threadId} threadId={threadId} seedMessage={seed} onTitleChange={setTitle} />
    </aside>
  );
};

export default AgentPanel;
