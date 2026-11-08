"use client";

import { Check, Keyboard, Mic, MicOff, Square, X } from "lucide-react";
import { Button } from "@/app/components/ui/button";
import { DayanaAiLogo } from "@/app/components/admin/crm/DayanaAiLogo";
import type { VoicePhase } from "@/lib/agent-ui/voice-mode";
import { cn } from "@/lib/utils";
import { VoiceBars } from "./VoiceBars";

const PHASE_LABEL: Record<VoicePhase, string> = {
  off: "",
  listening: "Te escucho…",
  thinking: "Pensando…",
  speaking: "Hablando…",
  confirming: "Confirma en pantalla",
  paused: "En pausa",
};

export type VoiceConfirm = { title: string; secondsLeft: number };

type Props = {
  phase: VoicePhase;
  heard: string;
  bands: number[];
  error: string | null;
  confirm: VoiceConfirm | null;
  /** Corta la voz del asistente y vuelve a escuchar. */
  onInterrupt: () => void;
  /** Pausa / reanuda la escucha. */
  onTogglePause: () => void;
  /** Termina ya la frase y la manda. */
  onSendNow: () => void;
  onExit: () => void;
  onApproveNow: () => void;
  onCancelConfirm: () => void;
};

/**
 * El modo voz en lugar de la caja de texto: un solo botón grande (lo que
 * toca hacer ahora), el estado en palabras y lo que se va entendiendo. Pensado
 * para el teléfono: botones de 44 px o más, sin menús.
 */
export const VoiceModeBar = ({
  phase,
  heard,
  bands,
  error,
  confirm,
  onInterrupt,
  onTogglePause,
  onSendNow,
  onExit,
  onApproveNow,
  onCancelConfirm,
}: Props) => {
  if (confirm) {
    return (
      <section
        data-testid="voice-approval-countdown"
        aria-live="assertive"
        className="flex flex-col gap-3 rounded-2xl border border-primary/40 bg-card p-3 shadow-sm"
      >
        <p className="text-sm text-foreground">
          Dijiste «sí»: apruebo <span className="font-medium">{confirm.title}</span> en {confirm.secondsLeft} s.
        </p>
        <div className="flex gap-2">
          <Button variant="outline" className="h-11 flex-1" onClick={onCancelConfirm} data-testid="voice-approval-cancel">
            <X className="size-4" /> Cancelar
          </Button>
          <Button className="h-11 flex-1" onClick={onApproveNow} data-testid="voice-approval-now">
            <Check className="size-4" /> Aprobar ya
          </Button>
        </div>
      </section>
    );
  }

  const main =
    phase === "speaking"
      ? { label: "Interrumpir", icon: <Square className="size-5 fill-current" />, onClick: onInterrupt }
      : phase === "listening" && heard
        ? { label: "Enviar ya", icon: <Check className="size-5" />, onClick: onSendNow }
        : phase === "paused"
          ? { label: "Hablar", icon: <Mic className="size-5" />, onClick: onTogglePause }
          : phase === "listening"
            ? { label: "Pausar", icon: <MicOff className="size-5" />, onClick: onTogglePause }
            : null;

  return (
    <section
      data-testid="voice-mode-bar"
      data-phase={phase}
      aria-label="Modo voz"
      className="flex items-center gap-3 rounded-2xl border border-border bg-card p-2.5 shadow-sm"
    >
      <div className="relative size-11 shrink-0">
        <DayanaAiLogo className="absolute top-1/2 left-1/2 size-16 -translate-x-1/2 -translate-y-1/2" active={phase === "speaking" || phase === "thinking"} />
      </div>
      <div className="min-w-0 flex-1" aria-live="polite">
        <p className={cn("text-sm font-medium", error ? "text-destructive" : "text-foreground")}>{error ?? PHASE_LABEL[phase]}</p>
        {phase === "listening" && !heard ? (
          <VoiceBars bands={bands} className="h-5 justify-start" />
        ) : (
          <p className="line-clamp-2 text-xs text-muted-foreground">
            {heard || (phase === "speaking" ? "Toca para cortarla y hablar tú." : phase === "paused" ? "Toca «Hablar» cuando quieras." : " ")}
          </p>
        )}
      </div>
      {main && (
        <Button
          size="icon"
          className={cn("size-11 shrink-0 rounded-full", phase === "listening" && !heard && "bg-destructive/10 text-destructive hover:bg-destructive/20")}
          variant={phase === "listening" && !heard ? "ghost" : "default"}
          aria-label={main.label}
          title={main.label}
          onClick={main.onClick}
          data-testid="voice-main-button"
        >
          {main.icon}
        </Button>
      )}
      <Button
        size="icon"
        variant="ghost"
        className="size-11 shrink-0 rounded-full"
        aria-label="Salir del modo voz (escribir)"
        title="Salir del modo voz"
        onClick={onExit}
        data-testid="voice-exit"
      >
        <Keyboard className="size-5" />
      </Button>
    </section>
  );
};
