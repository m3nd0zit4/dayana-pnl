"use client";

import { useRef, useState } from "react";
import { Check, ChevronDown, Mic, Paperclip, Send, Square, X } from "lucide-react";
import { useIsMobile } from "@/app/hooks/use-mobile";
import { Button } from "@/app/components/ui/button";
import { ButtonGroup, ButtonGroupSeparator } from "@/app/components/ui/button-group";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/app/components/ui/dropdown-menu";
import { Input } from "@/app/components/ui/input";
import { cn } from "@/lib/utils";
import { DayanaAiLogo } from "@/app/components/admin/crm/DayanaAiLogo";
import { useCrm } from "@/app/components/admin/crm/CrmProvider";
import { STT_LANGUAGES, useSpeechToText } from "./use-speech-to-text";
import { VoiceBars } from "./VoiceBars";

/**
 * Global floating "Ask anything" pill for mobile — the phone-width
 * replacement for the topbar agent-toggle icon (hidden below `lg`) and the
 * dashboard-only `HeroAskAgentBox`. Mounted once from `CrmShell`, visible on
 * every /admin page, never rendered at `lg`+ where the desktop aside/toggle
 * already cover this.
 */
const AgentAskPill = () => {
  const isMobile = useIsMobile();
  const { agentEnabled, agentPanelOpen, askAgent } = useCrm();
  const [value, setValue] = useState("");
  const [hovered, setHovered] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dictationBaseRef = useRef("");
  const stt = useSpeechToText((text) =>
    setValue(dictationBaseRef.current ? `${dictationBaseRef.current} ${text}` : text),
  );
  const handleMicToggle = () => {
    if (!stt.isRecording) dictationBaseRef.current = value;
    stt.toggle();
  };
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (picked.length > 0) setFiles((prev) => [...prev, ...picked]);
  };

  if (!isMobile || !agentEnabled || agentPanelOpen) return null;

  const submit = () => {
    // Sending mid-recording is one of the two ways to end dictation (the
    // other is the stop button) — the transcript captured so far is what
    // gets sent, nothing more is awaited from the mic.
    if (stt.isRecording) stt.stop();
    const message = value.trim();
    if (!message && files.length === 0) return;
    askAgent(message, files.length > 0 ? files : undefined);
    setValue("");
    setFiles([]);
  };

  return (
    <div
      className="fixed inset-x-4 z-20"
      style={{ bottom: "calc(var(--crm-bottom-nav-h) + env(safe-area-inset-bottom, 0px) + 0.75rem)" }}
    >
      {files.length > 0 && (
        <div className="mb-2 flex flex-wrap justify-center gap-1.5">
          {files.map((file, i) => (
            <span
              key={`${file.name}-${i}`}
              className="flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1 text-xs shadow-sm"
            >
              <Paperclip className="size-3" aria-hidden />
              <span className="max-w-32 truncate">{file.name}</span>
              <button
                type="button"
                aria-label={`Quitar ${file.name}`}
                onClick={() => setFiles((prev) => prev.filter((_, j) => j !== i))}
                className="text-muted-foreground hover:text-destructive"
              >
                <X className="size-3" />
              </button>
            </span>
          ))}
        </div>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        className="flex w-full items-center gap-3 rounded-full border border-border bg-card px-4 py-2.5 shadow-lg"
      >
        <div className="relative size-8 shrink-0">
          <DayanaAiLogo
            className="absolute top-1/2 left-1/2 size-14 -translate-x-1/2 -translate-y-1/2"
            active={hovered}
          />
        </div>
        {stt.isRecording ? (
          <VoiceBars bands={stt.bands} className="px-1" />
        ) : (
          <Input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="Pregunta"
            className="h-auto border-0 py-1.5 text-base shadow-none focus-visible:ring-0"
          />
        )}
        {!stt.isRecording && (
          <>
            <input ref={fileInputRef} type="file" multiple className="hidden" onChange={handleFileChange} />
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="shrink-0 rounded-full"
              aria-label="Adjuntar archivo"
              onClick={() => fileInputRef.current?.click()}
            >
              <Paperclip className="size-4" />
            </Button>
          </>
        )}
        {stt.isSupported && (
          <ButtonGroup className="shrink-0">
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className={cn("rounded-full", stt.isRecording && "text-destructive")}
              disabled={stt.isRequesting}
              aria-label={stt.isRecording ? "Detener grabación" : "Dictar por voz"}
              onClick={handleMicToggle}
            >
              {stt.isRecording ? <Square className="size-4 fill-current" /> : <Mic className="size-4" />}
            </Button>
            {!stt.isRecording && (
              <>
                <ButtonGroupSeparator />
                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={
                      <Button type="button" size="icon" variant="ghost" className="rounded-full px-1" aria-label="Idioma del dictado">
                        <ChevronDown className="size-3.5" />
                      </Button>
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
        <Button
          type="submit"
          size="icon"
          variant="ghost"
          className="shrink-0 rounded-full"
          disabled={!value.trim() && files.length === 0}
          aria-label="Preguntar"
        >
          <Send className="size-4" />
        </Button>
      </form>
      {stt.error && <p className="mt-1.5 px-4 text-center text-xs text-destructive">{stt.error}</p>}
    </div>
  );
};

export default AgentAskPill;
