"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { UserContent } from "ai";
import { defaultMessageReducer } from "eve/client";
import { useEveAgent } from "eve/react";
import {
  Check,
  ChevronDown,
  ChevronsLeftRight,
  Lightbulb,
  Mic,
  Paperclip,
  Send,
  Square,
  SquarePen,
  Trash2,
  UserRound,
  X,
} from "lucide-react";
import { useIsMobile } from "@/app/hooks/use-mobile";
import { Button } from "@/app/components/ui/button";
import { ButtonGroup, ButtonGroupSeparator } from "@/app/components/ui/button-group";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/app/components/ui/dropdown-menu";
import { useCrm } from "@/app/components/admin/crm/CrmProvider";
import { DayanaAiLogo } from "@/app/components/admin/crm/DayanaAiLogo";
import AgentMessage from "./AgentMessage";
import { findPendingInputPart, PendingInputBar } from "./agent-message/PendingInputBar";
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
import { deleteThread, deriveTitle, getThread, listThreads, upsertThread, type AgentThread } from "./thread-store";
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
  {
    id: "therapy-schedule-audit",
    name: "Sesiones sin agendar",
    description: "Paquetes activos con terapias pendientes o vencidas",
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

export const AgentPanelSession = ({
  threadId,
  seedMessage,
  seedFiles,
  onTitleChange,
}: {
  threadId: string;
  seedMessage?: string;
  seedFiles?: File[];
  onTitleChange: (title: string) => void;
}) => {
  const existing = useMemo(() => getThread(threadId), [threadId]);
  const titleRef = useRef(existing?.title ?? "Nueva conversación");
  // Prior turns render from this static snapshot instead of being fed to
  // `useEveAgent` as `initialEvents`. Reason: eve parks a session on
  // `session.waiting` between turns and keeps its `sessionId` — the normal
  // case, where reopening the thread resumes it cleanly. But a turn that
  // ended in `session.completed`/`session.failed` (any failed send, mainly)
  // makes eve's own client reset the persisted session state to blank (see
  // `advanceSession` in eve/client) — sessionId gone. Handing that blank
  // state to `useEveAgent` makes it silently start a brand-new backend
  // session on the next send, whose turn numbering restarts at turn_0 — and
  // if the old turn_0 were also sitting in the live store's `initialEvents`,
  // it would collide (eve keys messages by turn id alone, not
  // session-scoped): the real reply gets merged into the stale old bubble
  // instead of appearing, which reads as "the agent never responds" for any
  // reopened thread whose last turn failed. Keeping history entirely out of
  // the live store's turn-id space sidesteps the collision unconditionally
  // — the live store only ever sees turns from *this* mount, so there is
  // nothing for a fresh turn_0 to collide with, whether or not the resumed
  // session turned out to still be alive.
  const pastMessages = useMemo(() => {
    if (!existing || existing.events.length === 0) return [];
    const reducer = defaultMessageReducer();
    let data = reducer.initial();
    for (const event of existing.events) data = reducer.reduce(data, event);
    return data.messages;
  }, [existing]);
  const [input, setInput] = useState("");
  const [subPanel, setSubPanel] = useState<SubPanel>(null);
  const subPanelRef = useRef<HTMLDivElement>(null);
  const sentSeedRef = useRef(false);
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
    initialSession: existing?.session,
    onFinish: (snapshot) => {
      const firstUserText = snapshot.data.messages
        .find((m) => m.role === "user")
        ?.parts.find((p) => p.type === "text")?.text;
      if (firstUserText && titleRef.current === "Nueva conversación") {
        titleRef.current = deriveTitle(firstUserText);
        onTitleChange(titleRef.current);
      }
      // A run that fails before eve confirms anything finishes with zero
      // events. Persisting that produced a thread whose title was the
      // operator's question but whose transcript was empty on reopen — worse
      // than no thread at all, since it looks like the message was saved.
      if (snapshot.events.length === 0) return;
      // `snapshot.events` is this mount's live store, which — per the
      // `pastMessages` comment above — never received `existing.events` as
      // `initialEvents`. Prepend them by hand so persisting a turn doesn't
      // overwrite the thread's earlier history with just what happened since
      // this mount.
      upsertThread(threadId, {
        title: titleRef.current,
        session: snapshot.session,
        events: [...(existing?.events ?? []), ...snapshot.events],
      });
    },
  });

  // `onFinish` is the only place a thread got written, so closing the panel
  // (desktop unmounts the aside, mobile unmounts the drawer's session) while a
  // run was still streaming threw the whole conversation away. Mirror the
  // latest snapshot into a ref and flush it on unmount so a partial run
  // survives.
  const latestRef = useRef<{
    events: typeof agent.events;
    session?: typeof agent.session;
    firstUserText?: string;
  }>({ events: [] });

  useEffect(() => {
    latestRef.current = {
      events: agent.events,
      session: agent.session,
      firstUserText: agent.data.messages
        .find((m) => m.role === "user")
        ?.parts.find((p) => p.type === "text")?.text,
    };
  });

  useEffect(
    () => () => {
      const { events, session, firstUserText } = latestRef.current;
      if (events.length === 0) return;
      const title =
        titleRef.current === "Nueva conversación" && firstUserText
          ? deriveTitle(firstUserText)
          : titleRef.current;
      // Same merge as `onFinish` — `events` here is live-only too.
      upsertThread(threadId, {
        title,
        session,
        events: [...(existing?.events ?? []), ...events],
      });
    },
    [threadId, existing]
  );

  const isBusy = agent.status === "submitted" || agent.status === "streaming";

  useEffect(() => {
    if (sentSeedRef.current || (!seedMessage && !seedFiles?.length)) return;
    sentSeedRef.current = true;
    if (!seedFiles?.length) {
      void agent.send({ message: seedMessage ?? "" });
      return;
    }
    void (async () => {
      const parts: UserContent = [];
      if (seedMessage) parts.push({ type: "text", text: seedMessage });
      for (const file of seedFiles) {
        const dataUrl = await fileToDataUrl(file);
        parts.push({ type: "file", data: dataUrl, filename: file.name, mediaType: file.type });
      }
      await agent.send({ message: parts });
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seedMessage, seedFiles]);

  const handleSubmit = async (message: PromptInputMessage) => {
    // Sending mid-recording is one of the two ways to end dictation (the
    // other is the stop button) — the transcript captured so far is what
    // gets sent, nothing more is awaited from the mic.
    if (stt.isRecording) stt.stop();
    const text = message.text.trim();
    if ((text.length === 0 && message.files.length === 0) || isBusy) return;

    // PromptInputTextarea is controlled (`value={input}`), so PromptInput's
    // own `form.reset()` after submit only resets the uncontrolled DOM value
    // — the next render immediately overwrites it back to `input` state,
    // which is why the box kept showing the sent text. Clear it ourselves.
    setInput("");

    // A failed turn leaves the underlying eve session dead — eve's own store
    // never clears its accumulated events on that failure, and the *next*
    // send silently lands on a brand-new session whose turn numbering
    // restarts at turn_0. Since eve keys messages by turn id alone (not
    // session-scoped), that new turn_0 response collides with the old
    // failed turn_0's message id and gets merged into it — the failed
    // exchange's bubble "eats" the retry's real answer. The failed exchange
    // is already persisted to thread history (onFinish already ran for it),
    // so it's safe to clear the live view before retrying — that's what
    // stops the collision, since there's nothing left with a matching id.
    if (agent.status === "error") {
      agent.reset();
      // The failed exchange already derived a title from itself (onFinish
      // ran for it too) — without resetting this back, the fresh
      // conversation the reset just started would keep showing that stale
      // title instead of deriving its own from whatever comes next.
      titleRef.current = "Nueva conversación";
      onTitleChange(titleRef.current);
    }

    // PromptInput deliberately keeps the composer intact when onSubmit throws
    // ("user may want to retry"), but that only covers the uncontrolled DOM
    // value — clearing our own state above defeated it, so a send that failed
    // (model unreachable, router misconfigured) silently ate what was typed.
    // Put it back and rethrow so PromptInput keeps the attachments too.
    try {
      if (message.files.length === 0) {
        await agent.send({ message: text });
        return;
      }

      // `file.url` here is a `URL.createObjectURL(file)` blob: URL — only
      // ever valid inside this tab (see PromptInput's attachments context),
      // so sending it straight to the model meant the server received a URL
      // it could never fetch: every file attachment failed silently.
      // Uploading to Blob first (tried initially) doesn't fix it either —
      // this project's store is configured private-access-only ("Cannot use
      // public access on a private store"), and even a private blob isn't
      // fetchable by Gemini regardless, since generateContent only accepts
      // inline base64 or a URI from Gemini's own upload API, never an
      // arbitrary authenticated URL. Inlining as a data: URI sidesteps all
      // of that — no upload, no fetch, the bytes just travel in the request
      // body, exactly the `inline_data` shape Gemini already wants.
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
      await agent.send({ message: parts });
    } catch (err) {
      setInput(text);
      throw err;
    }
  };

  const handleRespond = (requestId: string, response: { optionId?: string; text?: string }) => {
    void agent.send({ inputResponses: [{ requestId, ...response }] });
  };

  const insertText = (text: string) => {
    setInput((prev) => (prev ? `${prev} ${text}` : text));
    setSubPanel(null);
  };

  const pendingInputPart = findPendingInputPart(agent.data.messages);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {pastMessages.length === 0 && agent.data.messages.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 px-4 text-center text-sm text-muted-foreground">
          <DayanaAiLogo className="size-20" active={isBusy} />
          Pregúntame sobre contactos, inscripciones o sesiones de terapia.
        </div>
      ) : (
        <Conversation className="min-h-0 flex-1">
          <ConversationContent className="mx-auto w-full max-w-2xl gap-6">
            {/* Read-only history from before this mount — never live, so it
                can't collide with this mount's own turn ids (see the
                `pastMessages` comment above). */}
            {pastMessages.map((message) => (
              // Prefixed: eve numbers turns fresh per session, so a past
              // message's id can collide with a live one from this mount's
              // own (possibly brand-new) session — these are two separate
              // arrays sharing one list visually, and React keys must be
              // unique across all of it, not just within each map.
              <AgentMessage key={`past-${message.id}`} message={message} isStreaming={false} isLastMessage={false} />
            ))}
            {agent.data.messages.map((message, index) => (
              <AgentMessage
                key={message.id}
                message={message}
                isStreaming={agent.status === "streaming" && index === agent.data.messages.length - 1}
                isLastMessage={index === agent.data.messages.length - 1}
              />
            ))}
            {agent.status === "submitted" && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <DayanaAiLogo className="size-8" active />
                Pensando…
              </div>
            )}
          </ConversationContent>
          <ConversationScrollButton />
        </Conversation>
      )}

      {pendingInputPart && (
        <PendingInputBar part={pendingInputPart} canRespond={!isBusy} onRespond={handleRespond} />
      )}

      {agent.status === "error" && agent.error && (
        <p className="shrink-0 px-3 pb-1 text-xs text-destructive">{agent.error.message}</p>
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
          onSubmit={(message) => void handleSubmit(message)}
          onError={(err) => console.error(err)}
          className="gap-1.5 rounded-full py-1 pr-1.5 pl-2"
        >
          {/* Same fixed-slot + overflow trick as the dashboard composer — keeps
              this pill's height stable while the logo renders bigger. */}
          <div className="relative size-6 shrink-0">
            <DayanaAiLogo
              className="absolute top-1/2 left-1/2 size-11 -translate-x-1/2 -translate-y-1/2"
              active={isBusy}
            />
          </div>
          {/* InputGroup (the pill this all sits in) has a `has-[>textarea]:h-auto`
              rule that only matches while the textarea is its DIRECT child —
              that's what lets the pill grow for multi-line text. Wrapping it
              unconditionally in a div (to anchor the recording-state bars
              overlay) broke that selector and capped the pill at a fixed
              height even while idle. Only wrap while actually recording,
              when a fixed height is correct anyway (the field is sr-only —
              still mounted so its `name="message"` value keeps participating
              in PromptInput's form-data submit — and nothing should be
              growing the pill while there's no visible text to grow it). */}
          {stt.isRecording ? (
            <div className="relative min-h-8 min-w-0 flex-1">
              <PromptInputTextarea
                disabled={isBusy}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                className="sr-only"
              />
              <VoiceBars bands={stt.bands} className="absolute inset-x-0 top-1/2 -translate-y-1/2" />
            </div>
          ) : (
            <PromptInputTextarea
              disabled={isBusy}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              className="min-h-0 max-h-32 py-1.5"
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
              must stay clickable — gating it on `isBusy` (as it used to) left
              a square "Detener" icon that never fired and no way to cancel.
              While recording it's the other of the two ways to end dictation
              (see handleSubmit) — sending whatever's been transcribed so far. */}
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
  const [seedFiles, setSeedFiles] = useState<File[] | undefined>(undefined);
  // Tracks the last pendingAgentAction object already applied — comparing it
  // against the current one from CrmProvider lets us adjust local state
  // directly during render (React's documented pattern for "adjust state
  // when a prop changes"), same technique ContactFormModal.tsx already uses
  // for its own open/wasOpen tracking, and avoids the multi-branch setState
  // sequence tripping react-hooks/set-state-in-effect inside a useEffect.
  const [lastAppliedAction, setLastAppliedAction] = useState<typeof pendingAgentAction>(null);
  const isMobile = useIsMobile();

  if (agentPanelOpen && pendingAgentAction && pendingAgentAction !== lastAppliedAction) {
    setLastAppliedAction(pendingAgentAction);
    if (pendingAgentAction.type === "message") {
      setThreadId(newThreadId());
      setTitle("Nueva conversación");
      setSeed(pendingAgentAction.value);
      setSeedFiles(pendingAgentAction.files);
    } else {
      setThreadId(pendingAgentAction.value);
      setTitle(getThread(pendingAgentAction.value)?.title ?? "Conversación");
      setSeed(undefined);
      setSeedFiles(undefined);
    }
  }

  // Clearing pendingAgentAction touches CrmProvider's state, not this
  // component's own — updating another component's state during render
  // (as the block above safely does for its own local state) isn't safe,
  // so this one part of the adjustment is deferred to an effect.
  useEffect(() => {
    if (lastAppliedAction && lastAppliedAction === pendingAgentAction) {
      clearPendingAgentAction();
    }
  }, [lastAppliedAction, pendingAgentAction, clearPendingAgentAction]);

  const startNewThread = () => {
    setThreadId(newThreadId());
    setTitle("Nueva conversación");
    setSeed(undefined);
    setSeedFiles(undefined);
  };

  const switchThread = (thread: AgentThread) => {
    setThreadId(thread.id);
    setTitle(thread.title);
    setSeed(undefined);
    setSeedFiles(undefined);
  };

  const handleDeleteThread = (id: string) => {
    deleteThread(id);
    setThreads(listThreads());
    if (id === threadId) startNewThread();
  };

  if (isMobile) {
    return (
      <AgentPanelMobile
        open={agentPanelOpen}
        onOpenChange={setAgentPanelOpen}
        title={title}
        threads={threads}
        onThreadsMenuOpen={() => setThreads(listThreads())}
        threadId={threadId}
        seed={seed}
        seedFiles={seedFiles}
        onTitleChange={setTitle}
        onNewThread={startNewThread}
        onSwitchThread={switchThread}
        onDeleteThread={handleDeleteThread}
      />
    );
  }

  if (!agentPanelOpen) return null;

  return (
    <aside
      className={`flex h-full min-h-0 flex-col border-l border-border bg-popover text-popover-foreground ${
        agentPanelExpanded ? "w-full flex-1" : "w-96 shrink-0"
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
              <DropdownMenuItem key={t.id} onClick={() => switchThread(t)} className="justify-between">
                <span className="min-w-0 flex-1 truncate">{t.title}</span>
                <button
                  type="button"
                  aria-label="Eliminar conversación"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDeleteThread(t.id);
                  }}
                  className="shrink-0 rounded p-0.5 text-muted-foreground hover:text-destructive"
                >
                  <Trash2 className="size-3.5" />
                </button>
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

      <AgentPanelSession
        key={threadId}
        threadId={threadId}
        seedMessage={seed}
        seedFiles={seedFiles}
        onTitleChange={setTitle}
      />
    </aside>
  );
};

export default AgentPanel;
