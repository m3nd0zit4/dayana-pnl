"use client";

import Link from "next/link";
import { Check, ChevronDown, Mic, Send, Square, TrendingUp, TriangleAlert } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { DashboardStats } from "@/lib/crm/dashboard-stats";
import { Alert, AlertDescription } from "@/app/components/ui/alert";
import { Button } from "@/app/components/ui/button";
import { ButtonGroup, ButtonGroupSeparator } from "@/app/components/ui/button-group";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/app/components/ui/dropdown-menu";
import { Input } from "@/app/components/ui/input";
import { useIsMobile } from "@/app/hooks/use-mobile";
import { cn } from "@/lib/utils";
import { DayanaAiLogo } from "./DayanaAiLogo";
import DashboardDotBackground from "./DashboardDotBackground";
import { useCrm } from "./CrmProvider";
import CrmPageShell from "./CrmPageShell";
import PromoCard from "./PromoCard";
import { STT_LANGUAGES, useSpeechToText } from "./agent-panel/use-speech-to-text";
import { VoiceBars } from "./agent-panel/VoiceBars";

const greeting = () => {
  const hour = new Date().getHours();
  if (hour < 12) return "Buenos días";
  if (hour < 19) return "Buenas tardes";
  return "Buenas noches";
};

const StatItem = ({ label, value }: { label: string; value: number | string }) => (
  <div>
    <p className="text-xs whitespace-nowrap text-muted-foreground">{label}</p>
    <p className="mt-0.5 flex items-center gap-1.5 text-lg font-semibold">
      {value}
      <TrendingUp className="size-3.5 text-muted-foreground/50" aria-hidden />
    </p>
  </div>
);

const HeroAskAgentBox = () => {
  const { agentEnabled, agentPanelOpen, askAgent } = useCrm();
  // Below lg, the globally-mounted AgentAskPill (rendered from CrmShell)
  // covers every page including this one — avoid showing both at once.
  const isMobile = useIsMobile();
  const [value, setValue] = useState("");
  const [hovered, setHovered] = useState(false);
  // Text already in the box when dictation starts — onTranscript reports the
  // full session transcript on every event (interim included), so it must
  // replace what dictation itself has produced so far, not append to it.
  const dictationBaseRef = useRef("");
  const stt = useSpeechToText((text) =>
    setValue(dictationBaseRef.current ? `${dictationBaseRef.current} ${text}` : text),
  );
  const handleMicToggle = () => {
    if (!stt.isRecording) dictationBaseRef.current = value;
    stt.toggle();
  };

  // Never show two live composers at once — the side panel has its own,
  // and mobile gets the floating AgentAskPill instead.
  if (!agentEnabled || agentPanelOpen || isMobile) return null;

  const submit = () => {
    // Sending mid-recording is one of the two ways to end dictation (the
    // other is the stop button) — the transcript captured so far is what
    // gets sent, nothing more is awaited from the mic.
    if (stt.isRecording) stt.stop();
    const message = value.trim();
    if (!message) return;
    askAgent(message);
    setValue("");
  };

  return (
    <div className="w-full">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        className="flex w-full items-center gap-3 rounded-full border border-border bg-card px-4 py-2.5 shadow-sm"
      >
        {/* Fixed size-8 slot keeps the pill's height stable; the logo itself
            renders larger and overflows the slot via absolute positioning
            so it doesn't inflate the row (and the input box with it). */}
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
          disabled={!value.trim()}
          aria-label="Preguntar"
        >
          <Send className="size-4" />
        </Button>
      </form>
      {stt.error && <p className="mt-1.5 px-4 text-center text-xs text-destructive">{stt.error}</p>}
    </div>
  );
};

type Props = {
  initialData?: DashboardStats | null;
  dbError?: boolean;
};

const DashboardClient = ({ initialData, dbError = false }: Props) => {
  const [data, setData] = useState<DashboardStats | null>(initialData ?? null);
  const [error, setError] = useState<string | null>(
    dbError ? "No se pudo cargar el dashboard. Revisa la base de datos." : null
  );

  useEffect(() => {
    if (initialData !== undefined) return;
    fetch("/api/admin/dashboard", { credentials: "same-origin" })
      .then(async (r) => {
        if (r.status === 401) throw new Error("unauthorized");
        if (!r.ok) throw new Error("fetch");
        return r.json() as Promise<DashboardStats>;
      })
      .then((json) => setData(json))
      .catch((err: Error) => {
        setError(
          err.message === "unauthorized"
            ? "Sesión expirada. Vuelve a iniciar sesión."
            : "No se pudo cargar el dashboard. Revisa la base de datos."
        );
      });
  }, [initialData]);

  if (error) {
    return (
      <CrmPageShell>
        <Alert>
          <TriangleAlert />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      </CrmPageShell>
    );
  }

  if (!data) {
    return (
      <CrmPageShell>
        <p className="animate-pulse text-sm text-muted-foreground">Cargando…</p>
      </CrmPageShell>
    );
  }

  const { stats } = data;

  return (
    <CrmPageShell>
      <div className="relative flex flex-col gap-10 py-2">
        <DashboardDotBackground />

        <div className="flex flex-wrap items-start justify-between gap-6">
          <div>
            <p className="text-sm text-muted-foreground">Resumen general</p>
            <p className="text-lg font-semibold tracking-tight">Últimos 14 días</p>
          </div>
          <div className="flex flex-wrap gap-6 sm:gap-8">
            <StatItem label="Leads / pendientes" value={stats.leads} />
            <StatItem label="Pagos hoy" value={stats.paymentsToday} />
            <StatItem label="Terapias activas" value={stats.activeTherapies} />
            <StatItem label="Contactos" value={stats.contacts} />
          </div>
        </div>

        <div className="mx-auto flex w-full max-w-2xl flex-col items-center gap-6 py-10 text-center">
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight">{greeting()}</h1>
            <p className="text-muted-foreground">Sigamos haciendo crecer tu negocio.</p>
          </div>
          <HeroAskAgentBox />
        </div>

        {stats.unlinkedPaidEnrollments > 0 && (
          <Link
            href="/admin/payments"
            className="block rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-center text-sm text-amber-800 transition-colors hover:bg-amber-500/15"
          >
            {stats.unlinkedPaidEnrollments} pago
            {stats.unlinkedPaidEnrollments === 1 ? "" : "s"} sin identificar
            (legacy) — revisar en Pagos
          </Link>
        )}

        <div className="mt-8 grid justify-items-center gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <PromoCard
            title="Pagos"
            description="Revisa pagos recientes y resuelve los que quedaron sin identificar."
            href="/admin/payments"
            image="/pagos-card.gif"
          />
          <PromoCard
            title="Códigos promocionales"
            description="Crea o ajusta descuentos para impulsar nuevas inscripciones."
            href="/admin/promo-codes"
            image="/codigos-card.gif"
          />
          <PromoCard
            title="Contactos"
            description="Busca, revisa y da seguimiento a tus contactos del CRM."
            href="/admin/contacts"
            image="/contactos-card.gif"
          />
        </div>
      </div>
    </CrmPageShell>
  );
};

export default DashboardClient;
