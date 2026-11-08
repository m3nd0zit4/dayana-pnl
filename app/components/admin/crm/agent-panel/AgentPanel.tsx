"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { UserContent } from "ai";
import { defaultMessageReducer, type HandleMessageStreamEvent } from "eve/client";
import { useEveAgent, type EveMessage } from "eve/react";
import { Check, ChevronDown, ChevronsLeftRight, Lightbulb, Mic, Paperclip, Send, Square, UserRound, X } from "lucide-react";
import type { AgentId } from "@/agent/lib/catalog";
import { agentPlaceholder } from "@/lib/agent-ui/agents";
import { isApprovalPart } from "@/lib/agent-ui/approval";
import { describeAgentError, lastFailureMessage } from "@/lib/agent-ui/errors";
import { collectNames } from "@/lib/agent-ui/refs";
import { withProxiedInputs } from "@/lib/agent-ui/proxied-input";
import { findPendingCallId, turnTimings, type TurnTiming } from "@/lib/agent-ui/steps";
import { openerContext, splitSessions, type ThreadOpener } from "@/lib/agent-ui/threads";
import { useIsMobile } from "@/app/hooks/use-mobile";
import { Button } from "@/app/components/ui/button";
import { ButtonGroup, ButtonGroupSeparator } from "@/app/components/ui/button-group";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/app/components/ui/dropdown-menu";
import { useCrm } from "@/app/components/admin/crm/CrmProvider";
import { DayanaAiLogo } from "@/app/components/admin/crm/DayanaAiLogo";
import AgentMessage from "./AgentMessage";
import { AgentEmptyState } from "./AgentEmptyState";
import { AgentPanelHeader } from "./AgentPanelHeader";
import { AgentChip, rememberAgentChoice, shortAgentPlaceholder } from "./AgentPicker";
import { ErrorBubble } from "./agent-message/ErrorBubble";
import { OpenerBubble } from "./agent-message/OpenerBubble";
import { PendingInputBar } from "./agent-message/PendingInputBar";
import AgentPanelMobile from "./AgentPanelMobile";
import { Conversation, ConversationContent, ConversationScrollButton } from "./ai-elements/conversation";
import {
  PromptInput,
  PromptInputActionAddAttachments,
  PromptInputActionMenu,
  PromptInputActionMenuContent,
  PromptInputActionMenuTrigger,
  PromptInputButton,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
  type PromptInputMessage,
} from "./ai-elements/prompt-input";
import { Shimmer } from "./ai-elements/shimmer";
import {
  DEFAULT_THREAD_TITLE,
  deleteThread,
  deriveTitle,
  findThreadByOpenerKey,
  getThread,
  syncThreads,
  upsertThread,
  useAgentThreadSync,
  useThreadsVersion,
  type AgentThread,
} from "./thread-store";
import type { AgentMessageSeed } from "./AgentMessageParam";
import { STT_LANGUAGES, useSpeechToText } from "./use-speech-to-text";
import { VoiceBars } from "./VoiceBars";

const newThreadId = () => crypto.randomUUID();

/** Gemini's `generateContent` only accepts inline base64 or its own upload
 * URI, never an arbitrary URL — so every file this panel sends, whatever its
 * source (a `PromptInput` blob: URL, a raw `File` from the dashboard's
 * lighter ask-boxes), ends up inlined as a data: URI before it travels. */
const fileToDataUrl = (file: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("No se pudo leer el archivo."));
    reader.readAsDataURL(file);
  });

const SKILLS = [
  {
    id: "stale-checkout-review",
    name: "Checkouts pendientes",
    description: "Pagos atascados que necesitan seguimiento",
    prompt: "Revisa los checkouts pendientes de pago y resume cuáles necesitan atención.",
  },
  {
    id: "contact-dedupe-check",
    name: "Posibles duplicados",
    description: "Compara contactos que podrían ser la misma persona",
    prompt: "Busca contactos que puedan estar duplicados y compáralos.",
  },
] as const;

type ContactHit = { id: string; firstName: string; lastName: string | null; phoneE164: string };

type SubPanel = "mention" | "skills" | null;

/**
 * Root "+" menu content — just three items. Selecting Mención/Skills closes
 * this menu normally (default `closeOnClick`) and opens a SEPARATE, plain
 * popover (see `SubPanelContent` below) rather than swapping this same
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
            className="flex items-start gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent"
            onClick={() => onInsertText(skill.prompt)}
          >
            <Lightbulb className="mt-0.5 size-4 shrink-0" />
            <span className="flex flex-col">
              <span>{skill.name}</span>
              <span className="text-xs text-muted-foreground">{skill.description}</span>
            </span>
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

type HistoryItem = { key: string; message: EveMessage; timing?: TurnTiming };

/**
 * Prior turns render from a static snapshot instead of being fed to
 * `useEveAgent` as `initialEvents`: eve numbers turns from zero in every
 * backend session and keys messages by turn id alone, so a resumed thread
 * whose session had died (a failed turn resets it) would merge the new
 * session's turn_0 into the old bubble. The live store only ever sees this
 * mount's turns; the stored log is split per session (`splitSessions`) and
 * each piece reduced on its own, keys prefixed so they never collide.
 */
const reduceHistory = (events: readonly HandleMessageStreamEvent[]): HistoryItem[] =>
  splitSessions(events).flatMap((segment, i) => {
    const reducer = withProxiedInputs(defaultMessageReducer());
    let data = reducer.initial();
    for (const event of segment) data = reducer.reduce(data, event);
    const timings = turnTimings(segment);
    return data.messages.map((message) => ({
      key: `past-${i}-${message.id}`,
      message,
      timing: message.metadata?.turnId ? timings.get(message.metadata.turnId) : undefined,
    }));
  });

const toolOutputs = (messages: readonly EveMessage[]): unknown[] =>
  messages.flatMap((m) => m.parts.flatMap((p) => (p.type === "dynamic-tool" && "output" in p ? [p.output] : [])));

type SendPayload = string | UserContent;

export const AgentPanelSession = ({
  threadId,
  agent: agentId,
  seedMessage,
  seedFiles,
  opener: newOpener,
  initialInput,
  onTitleChange,
  onRemoteUpdate,
  onPickAgent,
}: {
  threadId: string;
  agent: AgentId;
  seedMessage?: string;
  seedFiles?: File[];
  /** Only for a thread the assistant is starting now; a saved thread brings its own. */
  opener?: ThreadOpener;
  /** Text left in the box when the session was reloaded with turns from another device. */
  initialInput?: string;
  onTitleChange: (title: string) => void;
  /** The cache holds turns this session doesn't (another device continued it): remount, keeping `draft`. */
  onRemoteUpdate: (draft: string) => void;
  /**
   * Phone sheet only: an agent chip in the composer, so the agent can be
   * changed right where she types — with the iPhone keyboard up the sheet's
   * header is pushed off screen. Starts a new thread, keeping the draft.
   */
  onPickAgent?: (agent: AgentId, draft: string) => void;
}) => {
  const existing = useMemo(() => getThread(threadId), [threadId]);
  const opener = existing?.opener ?? newOpener;
  const titleRef = useRef(existing?.title ?? opener?.title ?? DEFAULT_THREAD_TITLE);
  // Events from before this mount's live store: the stored thread, plus any
  // live turns archived when a retry had to open a fresh session.
  const [history, setHistory] = useState<readonly HandleMessageStreamEvent[]>(() => existing?.events ?? []);
  const pastItems = useMemo(() => reduceHistory(history), [history]);
  const [input, setInput] = useState(initialInput ?? "");
  const [subPanel, setSubPanel] = useState<SubPanel>(null);
  const [retrying, setRetrying] = useState(false);
  // Mirrors lastSentRef for rendering: the retry button only exists once something was sent.
  const [canRetry, setCanRetry] = useState(false);
  const subPanelRef = useRef<HTMLDivElement>(null);
  const sentSeedRef = useRef(false);
  // True from the moment a send starts until it resolves: a failed run's
  // retry resets the live store before re-sending, and that gap must not
  // look like «idle with fewer turns than the cache».
  const sendingRef = useRef(false);
  // Events this session last saved: its own save must never read as «newer elsewhere».
  const savedCountRef = useRef(0);
  const lastSentRef = useRef<SendPayload | null>(null);
  // Text already in the box when dictation starts — live transcript is appended
  // after it and replaced wholesale on every recognition event (interim included),
  // rather than accumulated, so partial words correct themselves as you speak.
  const dictationBaseRef = useRef("");
  const stt = useSpeechToText((text) =>
    setInput(dictationBaseRef.current ? `${dictationBaseRef.current} ${text}` : text),
  );
  const handleMicToggle = () => {
    if (!stt.isRecording) dictationBaseRef.current = input;
    stt.toggle();
  };

  // A thread the assistant started is saved right away, before she answers,
  // so it survives a reload and shows in the threads menu under its title.
  useEffect(() => {
    if (!newOpener || getThread(threadId)) return;
    upsertThread(threadId, { title: titleRef.current, agent: agentId, events: [], opener: newOpener });
  }, [threadId, agentId, newOpener]);

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

  // A specialist's approval card must land in the current turn (see proxied-input.ts).
  const reducer = useMemo(() => withProxiedInputs(defaultMessageReducer()), []);
  const agent = useEveAgent({
    reducer,
    initialSession: existing?.session,
    // The server pins the session to this agent at its first turn; sending it
    // on every request keeps a fresh session (after a retry) on the same one.
    headers: { "x-crm-agent": agentId },
    onFinish: (snapshot) => {
      const firstUserText = [...pastItems.map((i) => i.message), ...snapshot.data.messages]
        .find((m) => m.role === "user")
        ?.parts.find((p) => p.type === "text")?.text;
      if (firstUserText && titleRef.current === DEFAULT_THREAD_TITLE) {
        titleRef.current = deriveTitle(firstUserText);
        onTitleChange(titleRef.current);
      }
      // A run that fails before eve confirms anything finishes with zero
      // events: saving it would leave a titled thread with an empty transcript.
      if (snapshot.events.length === 0) return;
      savedCountRef.current = history.length + snapshot.events.length;
      // Uploaded right away (not debounced): the turn is done, the other device should see it.
      upsertThread(
        threadId,
        {
          title: titleRef.current,
          agent: agentId,
          session: snapshot.session,
          events: [...history, ...snapshot.events],
          opener,
        },
        { immediate: true }
      );
    },
  });

  // Closing the panel mid-run unmounts this session; flush the latest
  // snapshot so a partial run isn't thrown away.
  const latestRef = useRef<{
    events: readonly HandleMessageStreamEvent[];
    history: readonly HandleMessageStreamEvent[];
    session?: typeof agent.session;
    firstUserText?: string;
  }>({ events: [], history: [] });

  useEffect(() => {
    latestRef.current = {
      events: agent.events,
      history,
      session: agent.session,
      firstUserText: agent.data.messages
        .find((m) => m.role === "user")
        ?.parts.find((p) => p.type === "text")?.text,
    };
  });

  useEffect(
    () => () => {
      const { events, history: past, session, firstUserText } = latestRef.current;
      if (events.length === 0 && past.length === (existing?.events.length ?? 0)) return;
      const title =
        titleRef.current === DEFAULT_THREAD_TITLE && firstUserText ? deriveTitle(firstUserText) : titleRef.current;
      upsertThread(threadId, { title, agent: agentId, session, events: [...past, ...events], opener });
    },
    [threadId, existing, agentId, opener]
  );

  const isBusy = agent.status === "submitted" || agent.status === "streaming";
  const isError = agent.status === "error";

  // Save (and upload) as soon as the turn is complete on screen. The stream
  // (and so eve's `onFinish`) stays open ~10 s after `turn.completed` /
  // `session.waiting`: in the two-device test a phone opened in that gap saw
  // no conversation, or an older one. `onFinish` still saves the final
  // session state; `upsertThread` skips it when nothing changed.
  const lastEventType = agent.events.at(-1)?.type;
  useEffect(() => {
    if (lastEventType !== "turn.completed" && lastEventType !== "session.waiting") return;
    const { firstUserText } = latestRef.current;
    const title =
      titleRef.current === DEFAULT_THREAD_TITLE && firstUserText ? deriveTitle(firstUserText) : titleRef.current;
    upsertThread(
      threadId,
      { title, agent: agentId, session: agent.session, events: [...history, ...agent.events], opener },
      { immediate: true }
    );
    // Only the moment the turn completes matters; the values are read then.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastEventType, agent.events.length]);

  /**
   * After a failure eve resets the session cursor (no `sessionId`): the next
   * send opens a new backend session numbered from turn_0 again. Move what
   * this mount saw into `history` first, so the failed exchange stays on
   * screen and can't collide with the new session's ids.
   */
  const prepareForSend = () => {
    if (agent.status !== "error" || agent.session?.sessionId) return;
    if (agent.events.length > 0) setHistory((h) => [...h, ...agent.events]);
    agent.reset();
  };

  const sendPayload = async (payload: SendPayload) => {
    lastSentRef.current = payload;
    setCanRetry(true);
    sendingRef.current = true;
    try {
      prepareForSend();
      // eve never saw the opener (written outside the session): remind it on every turn.
      await agent.send(opener ? { message: payload, clientContext: openerContext(opener) } : { message: payload });
    } finally {
      sendingRef.current = false;
    }
  };

  useEffect(() => {
    if (sentSeedRef.current || (!seedMessage && !seedFiles?.length)) return;
    sentSeedRef.current = true;
    void (async () => {
      if (!seedFiles?.length) {
        await sendPayload(seedMessage ?? "");
        return;
      }
      const parts: UserContent = [];
      if (seedMessage) parts.push({ type: "text", text: seedMessage });
      for (const file of seedFiles) {
        const dataUrl = await fileToDataUrl(file);
        parts.push({ type: "file", data: dataUrl, filename: file.name, mediaType: file.type });
      }
      await sendPayload(parts);
    })().catch(() => {
      // The failure shows as the error bubble; nothing else to do here.
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seedMessage, seedFiles]);

  const handleSubmit = async (message: PromptInputMessage) => {
    // Sending mid-recording is one of the two ways to end dictation (the
    // other is the stop button) — the transcript captured so far is what
    // gets sent, nothing more is awaited from the mic.
    if (stt.isRecording) stt.stop();
    const text = message.text.trim();
    if ((text.length === 0 && message.files.length === 0) || isBusy) return;

    // PromptInputTextarea is controlled, so PromptInput's own reset doesn't
    // clear it — clear it here, and put it back if the send throws.
    setInput("");

    try {
      if (message.files.length === 0) {
        await sendPayload(text);
        return;
      }

      // `file.url` is a tab-local blob: URL the model can never fetch, and the
      // Blob store is private — inline every file as a data: URI instead,
      // exactly the `inline_data` shape Gemini wants.
      const inlined = await Promise.all(
        message.files.map(async (file) => {
          const blob = await fetch(file.url).then((r) => r.blob());
          const dataUrl = await fileToDataUrl(blob);
          return { ...file, url: dataUrl };
        })
      );

      const parts: UserContent = [];
      if (text.length > 0) parts.push({ type: "text", text });
      for (const file of inlined) {
        parts.push({ type: "file", data: file.url, filename: file.filename, mediaType: file.mediaType });
      }
      await sendPayload(parts);
    } catch (err) {
      setInput(text);
      throw err;
    }
  };

  const handleRetry = async () => {
    const payload = lastSentRef.current;
    if (!payload || isBusy) return;
    setRetrying(true);
    try {
      await sendPayload(payload);
    } catch {
      // Still failing: the bubble stays with the new reason.
    } finally {
      setRetrying(false);
    }
  };

  const handleRespond = (requestId: string, response: { optionId?: string; text?: string }) => {
    void agent.send({ inputResponses: [{ requestId, ...response }] }).catch(() => {});
  };

  const insertText = (text: string) => {
    setInput((prev) => (prev ? `${prev} ${text}` : text));
    setSubPanel(null);
  };

  const liveTimings = useMemo(() => turnTimings(agent.events), [agent.events]);
  const pastMessages = useMemo(() => pastItems.map((i) => i.message), [pastItems]);
  const pendingCallId = findPendingCallId(agent.data.messages);
  // Reopening a thread that was closed while an approval waited: the session
  // is still parked on it (same sessionId), so the card comes back. Only for
  // approval gates — a replayed `ask_question` has no resolved event in
  // eve's log and would look pending forever.
  const resumedPending = useMemo(() => {
    if (agent.data.messages.length > 0 || !existing?.session?.sessionId) return null;
    const id = findPendingCallId(pastMessages);
    const part = id ? pastMessages.at(-1)?.parts.find((p) => p.type === "dynamic-tool" && p.toolCallId === id) : undefined;
    return part?.type === "dynamic-tool" && isApprovalPart(part) ? part : null;
  }, [agent.data.messages.length, existing, pastMessages]);
  const pendingPart = useMemo(() => {
    if (!pendingCallId) return resumedPending;
    const last = agent.data.messages.at(-1);
    const part = last?.parts.find((p) => p.type === "dynamic-tool" && p.toolCallId === pendingCallId);
    return part?.type === "dynamic-tool" ? part : null;
  }, [agent.data.messages, pendingCallId, resumedPending]);
  const names = useMemo(
    () => collectNames([...toolOutputs(pastMessages), ...toolOutputs(agent.data.messages)]),
    [pastMessages, agent.data.messages]
  );
  const errorReason = isError
    ? describeAgentError(agent.error?.message ?? lastFailureMessage(agent.events))
    : null;
  const isEmpty = !opener && pastItems.length === 0 && agent.data.messages.length === 0 && !isError;

  // Another device continued this thread (the sync pulled more events than
  // this session holds): reload it from the cache, the same remount as
  // switching threads, but only while idle: never mid-turn, with an
  // approval waiting or while dictating. What is typed in the box is kept.
  const threadsVersion = useThreadsVersion();
  const sessionEventCount = history.length + agent.events.length;
  const idle = !isBusy && !pendingPart && !retrying && !stt.isRecording;
  const inputRef = useRef(input);
  useEffect(() => {
    inputRef.current = input;
  });
  useEffect(() => {
    if (!idle || threadsVersion < 0 || sendingRef.current) return;
    const cached = getThread(threadId);
    if (cached && cached.events.length > Math.max(sessionEventCount, savedCountRef.current)) {
      onRemoteUpdate(inputRef.current);
    }
  }, [idle, threadsVersion, sessionEventCount, threadId, onRemoteUpdate]);
  const lastIndex = agent.data.messages.length - 1;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {isEmpty ? (
        <AgentEmptyState
          agent={agentId}
          disabled={isBusy}
          onSuggestion={(text) => void handleSubmit({ text, files: [] }).catch(() => {})}
        />
      ) : (
        <Conversation className="min-h-0 flex-1">
          <ConversationContent className="mx-auto w-full max-w-2xl gap-6">
            {opener && <OpenerBubble opener={opener} />}
            {pastItems.map((item, index) => (
              <AgentMessage
                key={item.key}
                message={item.message}
                isStreaming={false}
                pendingCallId={index === pastItems.length - 1 ? (resumedPending?.toolCallId ?? null) : null}
                timing={item.timing}
              />
            ))}
            {agent.data.messages.map((message, index) => (
              <AgentMessage
                key={message.id}
                message={message}
                isStreaming={agent.status === "streaming" && index === lastIndex}
                pendingCallId={index === lastIndex ? pendingCallId : null}
                timing={message.metadata?.turnId ? liveTimings.get(message.metadata.turnId) : undefined}
              />
            ))}
            {agent.status === "submitted" && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground" data-testid="agent-thinking">
                <DayanaAiLogo className="size-8" active />
                <Shimmer>Pensando…</Shimmer>
              </div>
            )}
            {isError && (
              <ErrorBubble
                reason={errorReason}
                retrying={retrying}
                onRetry={canRetry ? () => void handleRetry() : undefined}
              />
            )}
          </ConversationContent>
          <ConversationScrollButton aria-label="Ir al final" />
        </Conversation>
      )}

      {pendingPart && (
        <PendingInputBar part={pendingPart} canRespond={!isBusy} onRespond={handleRespond} names={names} />
      )}

      {stt.error && <p className="shrink-0 px-3 pb-1 text-xs text-destructive">{stt.error}</p>}

      <div
        className="relative mx-auto w-full max-w-2xl shrink-0 p-2.5"
        style={{ paddingBottom: "max(0.625rem, env(safe-area-inset-bottom))" }}
      >
        {subPanel && (
          <div
            ref={subPanelRef}
            className="absolute bottom-full left-2.5 z-10 mb-2 w-72 rounded-lg border border-border bg-popover p-2 text-popover-foreground shadow-md ring-1 ring-foreground/10"
          >
            <SubPanelContent panel={subPanel} onInsertText={insertText} />
          </div>
        )}
        <PromptInput
          onSubmit={(message) => void handleSubmit(message).catch(() => {})}
          onError={(err) => console.error(err)}
          className="gap-1.5 rounded-full py-1 pr-1.5 pl-2"
        >
          {onPickAgent ? (
            <AgentChip
              agent={agentId}
              testId="agent-composer-picker"
              onPick={(next) => {
                if (next !== agentId) onPickAgent(next, input);
              }}
              className="-my-0.5"
            />
          ) : (
            /* Same fixed-slot + overflow trick as the dashboard composer — keeps
               this pill's height stable while the logo renders bigger. */
            <div className="relative size-6 shrink-0">
              <DayanaAiLogo
                className="absolute top-1/2 left-1/2 size-11 -translate-x-1/2 -translate-y-1/2"
                active={isBusy}
              />
            </div>
          )}
          {/* InputGroup's `has-[>textarea]:h-auto` only matches while the
              textarea is its DIRECT child, so it's only wrapped while
              recording (sr-only, still in the form data) to anchor the bars. */}
          {stt.isRecording ? (
            <div className="relative min-h-8 min-w-0 flex-1">
              <PromptInputTextarea
                disabled={isBusy}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                className="sr-only"
                placeholder={agentPlaceholder(agentId)}
              />
              <VoiceBars bands={stt.bands} className="absolute inset-x-0 top-1/2 -translate-y-1/2" />
            </div>
          ) : (
            <PromptInputTextarea
              disabled={isBusy}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              className="min-h-0 max-h-32 py-1.5"
              placeholder={onPickAgent ? shortAgentPlaceholder(agentId) : agentPlaceholder(agentId)}
              aria-label={agentPlaceholder(agentId)}
            />
          )}
          <PromptInputTools className="shrink-0">
            {!stt.isRecording && (
              <PromptInputActionMenu>
                <PromptInputActionMenuTrigger tooltip="Adjuntar / mencionar / skills">
                  <Paperclip className="size-4" />
                </PromptInputActionMenuTrigger>
                <PromptInputActionMenuContent>
                  <RootMenuContent onSelect={setSubPanel} />
                </PromptInputActionMenuContent>
              </PromptInputActionMenu>
            )}
            {stt.isSupported && (
              <ButtonGroup>
                <PromptInputButton
                  type="button"
                  aria-pressed={stt.isRecording}
                  disabled={stt.isRequesting}
                  tooltip={
                    stt.error ??
                    (stt.isRequesting
                      ? "Solicitando permiso del micrófono…"
                      : stt.isRecording
                        ? "Detener grabación"
                        : "Dictar por voz")
                  }
                  className={stt.isRecording ? "text-destructive" : undefined}
                  onClick={handleMicToggle}
                >
                  {stt.isRecording ? <Square className="size-4 fill-current" /> : <Mic className="size-4" />}
                </PromptInputButton>
                {!stt.isRecording && (
                  <>
                    <ButtonGroupSeparator />
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        render={
                          <PromptInputButton type="button" tooltip="Idioma del dictado" className="px-1">
                            <ChevronDown className="size-3.5" />
                          </PromptInputButton>
                        }
                      />
                      <DropdownMenuContent align="start">
                        {STT_LANGUAGES.map((lang) => (
                          <DropdownMenuItem key={lang.code} onClick={() => stt.setLanguage(lang.code)}>
                            <span className="flex-1">{lang.label}</span>
                            {stt.language === lang.code && <Check className="size-4" />}
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </>
                )}
              </ButtonGroup>
            )}
          </PromptInputTools>
          {/* While a run is in flight this button IS the stop control, so it
              must stay clickable. While recording it's the other way to end
              dictation (see handleSubmit). */}
          <PromptInputSubmit
            status={agent.status}
            onStop={agent.stop}
            disabled={isBusy ? false : !input.trim()}
            className="static size-8 shrink-0"
          >
            <Send className="size-4" />
          </PromptInputSubmit>
        </PromptInput>
      </div>
    </div>
  );
};

type PanelThread = {
  id: string;
  title: string;
  agent: AgentId;
  seed?: string;
  seedFiles?: File[];
  /** Set only when the assistant starts this thread now (`?agentMessage=`). */
  opener?: ThreadOpener;
  /** Bumped to remount the session when another device added turns to this thread. */
  rev?: number;
  /** The box's text carried over that remount. */
  draft?: string;
};

const freshThread = (agent: AgentId): PanelThread => ({ id: newThreadId(), title: DEFAULT_THREAD_TITLE, agent });

const openerThread = (seed: AgentMessageSeed): PanelThread => {
  const title = seed.title.trim() || DEFAULT_THREAD_TITLE;
  return {
    ...freshThread(seed.agent),
    title,
    opener: { key: seed.key, title, message: seed.message, createdAt: seed.createdAt, source: seed.source },
  };
};

/** How long opening an assistant message waits for the sync before starting a thread here. */
const OPENER_SYNC_WAIT_MS = 4_000;

const AgentPanel = () => {
  const {
    agentPanelOpen,
    setAgentPanelOpen,
    agentPanelExpanded,
    setAgentPanelExpanded,
    pendingAgentAction,
    clearPendingAgentAction,
  } = useCrm();
  const [thread, setThread] = useState<PanelThread>(() => freshThread("auto"));
  // Tracks the last pendingAgentAction already applied — React's documented
  // "adjust state when a prop changes" pattern, applied during render.
  const [lastAppliedAction, setLastAppliedAction] = useState<typeof pendingAgentAction>(null);
  // The assistant message being opened, while the sync checks whether another
  // device already has its thread (so the phone and the computer share one).
  const [openerWait, setOpenerWait] = useState<AgentMessageSeed | null>(null);
  const isMobile = useIsMobile();
  const asideRef = useRef<HTMLElement>(null);
  useAgentThreadSync();

  if (agentPanelOpen && pendingAgentAction && pendingAgentAction !== lastAppliedAction) {
    setLastAppliedAction(pendingAgentAction);
    if (pendingAgentAction.type === "message") {
      setThread({
        ...freshThread(pendingAgentAction.agent ?? "auto"),
        seed: pendingAgentAction.value,
        seedFiles: pendingAgentAction.files,
      });
    } else if (pendingAgentAction.type === "new") {
      if (!(pendingAgentAction.keepIfSame && thread.agent === pendingAgentAction.agent)) {
        setThread(freshThread(pendingAgentAction.agent));
      }
    } else if (pendingAgentAction.type === "opener") {
      const { seed } = pendingAgentAction;
      const stored = findThreadByOpenerKey(seed.key);
      if (stored) {
        setOpenerWait(null);
        setThread({ id: stored.id, title: stored.title, agent: stored.agent });
      } else {
        setOpenerWait(seed);
      }
    } else {
      const stored = getThread(pendingAgentAction.value);
      setThread({
        id: pendingAgentAction.value,
        title: stored?.title ?? "Conversación",
        agent: stored?.agent ?? "auto",
      });
    }
  }

  // Not in this device's cache: sync first (the thread may have been started
  // on another device), then open it or start it here.
  useEffect(() => {
    if (!openerWait) return;
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      const stored = findThreadByOpenerKey(openerWait.key);
      setThread(stored ? { id: stored.id, title: stored.title, agent: stored.agent } : openerThread(openerWait));
      setOpenerWait(null);
    };
    const timer = setTimeout(finish, OPENER_SYNC_WAIT_MS);
    void syncThreads().finally(finish);
    return () => {
      done = true;
      clearTimeout(timer);
    };
  }, [openerWait]);

  // Clearing pendingAgentAction touches CrmProvider's state, so it waits for an effect.
  useEffect(() => {
    if (lastAppliedAction && lastAppliedAction === pendingAgentAction) {
      clearPendingAgentAction();
    }
  }, [lastAppliedAction, pendingAgentAction, clearPendingAgentAction]);

  const startNewThread = useCallback((agent: AgentId, draft?: string) => {
    // The phone pill sends its next message to the agent last picked here.
    rememberAgentChoice(agent);
    setThread({ ...freshThread(agent), draft });
  }, []);
  const switchThread = useCallback((t: AgentThread) => {
    rememberAgentChoice(t.agent);
    setThread({ id: t.id, title: t.title, agent: t.agent });
  }, []);
  const setTitle = useCallback((title: string) => setThread((t) => ({ ...t, title })), []);
  const reloadFromCache = useCallback(
    (draft: string) =>
      setThread((t) => ({
        id: t.id,
        title: getThread(t.id)?.title ?? t.title,
        agent: t.agent,
        rev: (t.rev ?? 0) + 1,
        draft,
      })),
    []
  );

  const handleDeleteThread = (id: string) => {
    deleteThread(id);
    if (id === thread.id) startNewThread(thread.agent);
  };

  const header = (trailing: ReactNode, touch?: boolean) => (
    <AgentPanelHeader
      agent={thread.agent}
      title={thread.title}
      threadId={thread.id}
      onNewThread={startNewThread}
      onSwitchThread={switchThread}
      onDeleteThread={handleDeleteThread}
      trailing={trailing}
      touch={touch}
    />
  );

  const session = openerWait ? (
    <div
      className="flex min-h-0 flex-1 items-center justify-center p-6 text-sm text-muted-foreground"
      data-testid="agent-opener-loading"
    >
      <Shimmer>Abriendo la conversación…</Shimmer>
    </div>
  ) : (
    <AgentPanelSession
      key={`${thread.id}:${thread.rev ?? 0}`}
      threadId={thread.id}
      agent={thread.agent}
      seedMessage={thread.seed}
      seedFiles={thread.seedFiles}
      opener={thread.opener}
      initialInput={thread.draft}
      onTitleChange={setTitle}
      onRemoteUpdate={reloadFromCache}
      onPickAgent={isMobile ? startNewThread : undefined}
    />
  );

  if (isMobile) {
    return (
      <AgentPanelMobile
        open={agentPanelOpen}
        onOpenChange={setAgentPanelOpen}
        header={header(
          <Button variant="ghost" size="icon" className="size-10 shrink-0" aria-label="Cerrar" onClick={() => setAgentPanelOpen(false)}>
            <X className="size-4" />
          </Button>,
          true
        )}
      >
        {session}
      </AgentPanelMobile>
    );
  }

  if (!agentPanelOpen) return null;

  return (
    <aside
      ref={asideRef}
      aria-label="Asistente del CRM"
      data-testid="agent-panel"
      data-expanded={agentPanelExpanded ? "true" : undefined}
      onKeyDown={(e) => {
        // Esc closes the panel — but not when it was meant for a menu or
        // popover (portaled, so its target is outside the aside).
        if (e.key !== "Escape" || e.defaultPrevented) return;
        if (!asideRef.current?.contains(e.target as Node)) return;
        setAgentPanelOpen(false);
      }}
      className={`flex h-full min-h-0 flex-col border-l border-border bg-popover text-popover-foreground ${
        agentPanelExpanded ? "w-full flex-1" : "w-96 shrink-0"
      }`}
    >
      <header className="flex shrink-0 items-center gap-1 border-b border-border px-2 py-1.5">
        {header(
          <>
            <Button
              variant="ghost"
              size="icon"
              className="size-7 shrink-0"
              aria-label={agentPanelExpanded ? "Contraer" : "Expandir"}
              title={agentPanelExpanded ? "Contraer" : "Expandir"}
              onClick={() => setAgentPanelExpanded(!agentPanelExpanded)}
            >
              <ChevronsLeftRight className="size-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="size-7 shrink-0"
              aria-label="Cerrar"
              title="Cerrar (Esc)"
              onClick={() => setAgentPanelOpen(false)}
            >
              <X className="size-4" />
            </Button>
          </>
        )}
      </header>

      {session}
    </aside>
  );
};

export default AgentPanel;
