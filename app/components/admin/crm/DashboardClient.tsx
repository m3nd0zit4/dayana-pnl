"use client";

import Link from "next/link";
import { ChevronRight, CircleCheck, Mic, Send, Square, TriangleAlert } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { DashboardStats } from "@/lib/crm/dashboard-stats";
import type { Pendiente } from "@/lib/crm/pendientes";
import { Alert, AlertDescription } from "@/app/components/ui/alert";
import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import { useIsMobile } from "@/app/hooks/use-mobile";
import { cn } from "@/lib/utils";
import { DayanaAiLogo } from "./DayanaAiLogo";
import DashboardDotBackground from "./DashboardDotBackground";
import { useCrm } from "./CrmProvider";
import CrmPageHeader from "./CrmPageHeader";
import CrmPageShell from "./CrmPageShell";
import CrmPaymentsChart from "./CrmPaymentsChart";
import CrmPipelineChart from "./CrmPipelineChart";
import { useSpeechToText } from "./agent-panel/use-speech-to-text";
import { VoiceBars } from "./agent-panel/VoiceBars";
import { CrmLoadingState } from "./ui";

/**
 * «Qué hay que hacer hoy»: lo primero de la portada.
 *
 * Cada fila es un número y un enlace a la pantalla donde se resuelve. Si no hay
 * nada, lo dice — una portada que sólo sabe avisar se deja de leer, y una que
 * calla cuando todo va bien obliga a revisar a mano.
 *
 * Las conversaciones sin responder sólo se enseñan con la bandeja encendida:
 * con el interruptor apagado su enlace llevaría a un 404.
 */
const PendientesList = ({ pendientes }: { pendientes: Pendiente[] }) => {
  const { metaInboxEnabled } = useCrm();
  const visible = pendientes.filter(
    (p) => p.key !== "conversaciones-sin-responder" || metaInboxEnabled
  );

  return (
    <section aria-labelledby="pendientes-title" className="space-y-3">
      <h2 id="pendientes-title" className="text-sm font-medium">
        Para hoy
      </h2>
      {visible.length === 0 ? (
        <p className="flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-3 text-sm text-muted-foreground">
          <CircleCheck className="size-4 text-success" aria-hidden />
          Todo al día: no hay nada pendiente.
        </p>
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
          {visible.map((p) => (
            <li key={p.key}>
              <Link
                href={p.href}
                className="flex items-center gap-3 px-4 py-3 text-sm hover:bg-accent/50"
              >
                <span
                  className={cn(
                    "min-w-8 rounded-md px-2 py-0.5 text-center text-sm font-semibold tabular-nums",
                    p.tone === "alert"
                      ? "bg-destructive/10 text-destructive"
                      : "bg-muted text-foreground"
                  )}
                >
                  {p.count}
                </span>
                <span className="flex-1">{p.label}</span>
                <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
};

const greeting = () => {
  const hour = new Date().getHours();
  if (hour < 12) return "Buenos días";
  if (hour < 19) return "Buenas tardes";
  return "Buenas noches";
};

const todayLabel = () => {
  const label = new Date().toLocaleDateString("es-CO", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
  return label.charAt(0).toUpperCase() + label.slice(1);
};

const StatItem = ({
  label,
  value,
  href,
}: {
  label: string;
  value: number | string;
  href?: string;
}) => {
  const body = (
    <>
      <span className="block text-xs whitespace-nowrap text-muted-foreground">{label}</span>
      <span className="mt-0.5 block text-lg font-semibold">{value}</span>
    </>
  );
  return href ? (
    <Link href={href} className="rounded-md hover:underline">
      {body}
    </Link>
  ) : (
    <div>{body}</div>
  );
};

/**
 * La caja para preguntarle al asistente. Sólo texto, dictado y enviar: adjuntar
 * archivos y el idioma del dictado siguen en el panel del asistente, que se
 * abre al enviar.
 */
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
    if (stt.isRecording) stt.stop();
    const message = value.trim();
    if (!message) return;
    askAgent(message);
    setValue("");
  };

  return (
    <div className="mx-auto w-full max-w-2xl">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        className="flex w-full items-center gap-3 rounded-full border border-border bg-card px-4 py-2.5 shadow-sm"
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
            placeholder="Pregúntale al asistente"
            aria-label="Pregúntale al asistente"
            className="h-auto border-0 py-1.5 text-base shadow-none focus-visible:ring-0"
          />
        )}
        {stt.isSupported && (
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className={cn("shrink-0 rounded-full", stt.isRecording && "text-destructive")}
            disabled={stt.isRequesting}
            aria-label={stt.isRecording ? "Detener grabación" : "Dictar por voz"}
            onClick={handleMicToggle}
          >
            {stt.isRecording ? <Square className="size-4 fill-current" /> : <Mic className="size-4" />}
          </Button>
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

/**
 * Números y gráficas, siempre a la vista: Dayana los mira al entrar.
 *
 * Estuvieron plegados y dejaron de verse. Cada cifra dice su propio alcance
 * —no todas son «de los últimos 14 días»: leads, terapias y contactos son el
 * total, y los pagos son los de hoy—, así que el título es sólo «Números».
 */
const NumbersSection = ({ data }: { data: DashboardStats }) => {
  const { stats } = data;

  return (
    <section aria-labelledby="numeros-title" className="space-y-3">
      <h2 id="numeros-title" className="text-sm font-medium">
        Números
      </h2>
      <div className="flex flex-wrap gap-6 rounded-lg border border-border bg-card px-4 py-3 sm:gap-8">
        <StatItem label="Leads y pagos pendientes" value={stats.leads} />
        <StatItem label="Pagos de hoy" value={stats.paymentsToday} href="/admin/payments" />
        <StatItem label="Terapias activas" value={stats.activeTherapies} />
        <StatItem label="Contactos en total" value={stats.contacts} href="/admin/contacts" />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <CrmPaymentsChart data={data.paymentsByDay} />
        <CrmPipelineChart data={data.pipeline} />
      </div>
    </section>
  );
};

type Props = {
  initialData?: DashboardStats | null;
  dbError?: boolean;
};

/**
 * La portada del panel: el saludo, «Para hoy» y, plegado, los números.
 *
 * Antes abría con cuatro cifras sin enlace, las gráficas y tres tarjetas que
 * repetían entradas del menú; lo que había que hacer hoy quedaba en medio.
 */
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
        <CrmPageHeader title="Inicio" />
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
        <CrmPageHeader title="Inicio" />
        <CrmLoadingState rows={4} />
      </CrmPageShell>
    );
  }

  return (
    <CrmPageShell>
      <CrmPageHeader title={greeting()} description={todayLabel()} />
      <div className="relative flex flex-col gap-8">
        <DashboardDotBackground />
        <PendientesList pendientes={data.pendientes} />
        <NumbersSection data={data} />
        <HeroAskAgentBox />
      </div>
    </CrmPageShell>
  );
};

export default DashboardClient;
