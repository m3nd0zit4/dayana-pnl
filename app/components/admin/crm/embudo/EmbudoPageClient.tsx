"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { CalendarClock, MessagesSquare, PhoneCall, PhoneIncoming, Send, TriangleAlert, UserRound, UsersRound } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/app/components/ui/alert";
import { Badge } from "@/app/components/ui/badge";
import { Button } from "@/app/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/app/components/ui/select";
import { needsFollowUp, type Channel, type LeadStage } from "@/lib/crm/call-funnel/rules";
import type { FollowUp, FunnelLeadRow, FunnelStats } from "@/lib/crm/call-funnel/server";
import { personFirstName } from "@/lib/person-name";
import { buildContactWhatsAppUrl } from "@/lib/whatsapp-contact";
import CrmPageHeader from "../CrmPageHeader";
import CrmPageShell from "../CrmPageShell";
import { useCrm } from "../CrmProvider";
import CrmSegmentedControl from "../CrmSegmentedControl";
import {
  CrmDataList,
  CrmDataListRow,
  CrmEmptyState,
  CrmErrorState,
  CrmFilterBar,
  CrmLoadingState,
  CrmPublicLink,
  CrmRowAction,
  CrmRowActions,
  CrmSearchInput,
} from "../ui";
import FunnelSettings, { type FunnelSettingsValue } from "./FunnelSettings";
import FunnelSummary from "./FunnelSummary";

/** La página pública del embudo. */
const PUBLIC_PATH = "/llamada";

/**
 * Una persona del embudo, con las fechas ya escritas en el servidor (en la
 * zona de Dayana): así el servidor y el navegador pintan lo mismo.
 */
export type FunnelRowView = FunnelLeadRow & {
  /** «jueves 12 de noviembre, 4:15 p. m.»; null si no tiene llamada. */
  callLabel: string | null;
  /** «hoy», «ayer» o «el 8 nov». */
  cameLabel: string;
};

export type FunnelGroup = "todas" | "seguimiento" | "llamada" | "hablaron";

const FOLLOW_UP_LABEL: Record<FollowUp, string> = {
  nuevo: "Nuevo",
  contactada: "Ya le escribí",
  descartada: "No le interesa",
};

/** El tono de la etiqueta de cada paso (solo tokens). */
const STAGE_TONE: Record<LeadStage, string> = {
  datos: "text-muted-foreground",
  preguntas: "",
  agendada: "border-success/40 bg-success/10 text-success",
  hablaron: "border-success/40 text-success",
  no_contesto: "border-warning/40 text-warning",
  pasada: "border-warning/40 text-warning",
  cancelada: "text-muted-foreground",
};

/** Le falta un seguimiento: sin llamada y nadie le ha escrito todavía. */
const pendingFollowUp = (r: FunnelLeadRow): boolean => needsFollowUp(r.stage) && r.followUp === "nuevo";

const inGroup = (r: FunnelLeadRow, group: FunnelGroup): boolean => {
  if (group === "seguimiento") return pendingFollowUp(r);
  if (group === "llamada") return r.stage === "agendada" || r.stage === "pasada" || r.stage === "no_contesto";
  if (group === "hablaron") return r.stage === "hablaron";
  return true;
};

/** El mensaje que queda escrito en WhatsApp para invitarle a elegir su hora (Dayana lo puede cambiar antes de enviarlo). */
const inviteMessage = (r: FunnelLeadRow, publicUrl: string): string => {
  const name = personFirstName(r.name);
  const hello = name ? `Hola ${name}.` : "Hola.";
  const why =
    r.stage === "cancelada"
      ? "Te escribo del equipo de Dayana Beltrán: vimos que cancelaste tu llamada gratis. Si quieres retomarla, puedes elegir otra hora aquí:"
      : "Te escribo del equipo de Dayana Beltrán: vimos que pediste tu llamada gratis y te faltó elegir la hora. Puedes escogerla aquí:";
  return `${hello} ${why} ${publicUrl} ¿Te ayudo a agendarla?`;
};

const ALL_CHANNELS = "todos";

/** La nota que dejó la persona: dos líneas, y entera al tocar «Ver todo». */
const Note = ({ text }: { text: string }) => {
  const [open, setOpen] = useState(false);
  const long = text.length > 140;
  return (
    <p className="mt-1 text-sm [overflow-wrap:anywhere]">
      <span className={open || !long ? undefined : "line-clamp-2"} title={long && !open ? text : undefined}>
        «{text}»
      </span>
      {long ? (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="rounded-sm text-xs text-muted-foreground underline underline-offset-4 outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          {open ? "Ver menos" : "Ver todo"}
        </button>
      ) : null}
    </p>
  );
};

type Props = {
  /** null: no se pudieron cargar. */
  rows: FunnelRowView[] | null;
  stats: FunnelStats | null;
  config: FunnelSettingsValue;
  /** «hora de Colombia». */
  tzLabel: string;
  /** Cuántos días hacia atrás se listan. */
  windowDays: number;
  /** La dirección completa de la página pública, para el mensaje de WhatsApp. */
  publicUrl: string;
  initialGroup?: FunnelGroup;
};

/**
 * «Embudo»: quién pidió su llamada gratis en la página (`/llamada`), de dónde
 * llegó, hasta dónde avanzó y a quién hay que escribirle. Las filas las crea la
 * página pública, así que aquí no hay «Nuevo». La llamada agendada es la misma
 * cita de WhatsApp → Agenda.
 */
const EmbudoPageClient = ({ rows: loadedRows, stats, config: initialConfig, tzLabel, windowDays, publicUrl, initialGroup = "todas" }: Props) => {
  const router = useRouter();
  const { toast, confirm, canWrite, canManageTeam } = useCrm();
  const [reloading, startReload] = useTransition();

  // El seguimiento marcado en esta pantalla, encima de lo que llegó del servidor.
  const [followUps, setFollowUps] = useState<Record<string, FollowUp>>({});
  const rows = useMemo(
    () => (loadedRows ?? []).map((r) => (followUps[r.id] && followUps[r.id] !== r.followUp ? { ...r, followUp: followUps[r.id] } : r)),
    [loadedRows, followUps]
  );

  const [group, setGroup] = useState<FunnelGroup>(initialGroup);
  // A quien se le acaba de marcar el seguimiento no desaparece de «Por hacer
  // seguimiento» bajo el dedo: sigue ahí hasta cambiar de filtro.
  const [kept, setKept] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const [channel, setChannel] = useState<Channel | typeof ALL_CHANNELS>(ALL_CHANNELS);

  const [config, setConfig] = useState(initialConfig);
  const [savingConfig, setSavingConfig] = useState(false);

  const toFollowUp = useMemo(() => rows.filter(pendingFollowUp).length, [rows]);
  const channels = stats?.byChannel ?? [];

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (!inGroup(r, group) && !(group === "seguimiento" && kept.has(r.id))) return false;
      if (channel !== ALL_CHANNELS && r.channel !== channel) return false;
      if (!q) return true;
      return [r.name, r.phoneE164, r.campaign, r.topic, r.note].some((v) => v?.toLowerCase().includes(q));
    });
  }, [rows, group, kept, channel, query]);

  const saveFollowUp = async (r: FunnelRowView, next: FollowUp) => {
    const before = r.followUp;
    setFollowUps((all) => ({ ...all, [r.id]: next }));
    setKept((all) => new Set(all).add(r.id));
    const res = await fetch(`/api/admin/embudo/${encodeURIComponent(r.id)}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ followUp: next }),
    }).catch(() => null);
    if (!res?.ok) {
      setFollowUps((all) => ({ ...all, [r.id]: before }));
      toast("No se pudo guardar el seguimiento.", "error");
      return;
    }
    toast(`Seguimiento de ${r.name}: ${FOLLOW_UP_LABEL[next]}`);
  };

  const saveConfig = async (patch: Partial<FunnelSettingsValue>, done: string) => {
    const before = config;
    setConfig({ ...config, ...patch });
    setSavingConfig(true);
    const res = await fetch("/api/admin/embudo", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
    }).catch(() => null);
    const data = res?.ok ? ((await res.json().catch(() => null)) as { config?: FunnelSettingsValue } | null) : null;
    setSavingConfig(false);
    if (!data?.config) {
      setConfig(before);
      toast(res?.status === 403 ? "No tienes permiso para cambiar esto." : "No se pudo guardar el cambio.", "error");
      return;
    }
    setConfig(data.config);
    toast(done);
  };

  const togglePage = (enabled: boolean) => {
    if (enabled) {
      void saveConfig({ enabled: true }, "La página quedó abierta.");
      return;
    }
    confirm({
      title: "¿Cerrar la página pública?",
      message:
        "Mientras esté cerrada nadie podrá agendar en /llamada: se le invita a escribir por WhatsApp. Las llamadas que ya están agendadas no cambian.",
      confirmLabel: "Cerrar la página",
      onConfirm: () => saveConfig({ enabled: false }, "La página quedó cerrada."),
    });
  };

  const segments = [
    { id: "todas" as const, label: "Todas", icon: UsersRound, count: rows.length },
    { id: "seguimiento" as const, label: "Por hacer seguimiento", shortLabel: "Seguimiento", icon: PhoneIncoming, count: toFollowUp },
    {
      id: "llamada" as const,
      label: "Con llamada",
      icon: CalendarClock,
      count: rows.filter((r) => inGroup(r, "llamada")).length,
    },
    {
      id: "hablaron" as const,
      label: "Ya hablaron",
      shortLabel: "Hablaron",
      icon: PhoneCall,
      count: rows.filter((r) => inGroup(r, "hablaron")).length,
    },
  ];

  return (
    <CrmPageShell>
      <CrmPageHeader
        title="Embudo de llamadas gratis"
        description={`Quién pidió su llamada gratis en la página, de dónde llegó y en qué va. Últimos ${windowDays} días; las horas de las llamadas van en ${tzLabel}.`}
        secondaryActions={<CrmPublicLink href={PUBLIC_PATH} label="Ver página pública" copy />}
        trailing={
          rows.length > 0 ? (
            <CrmSegmentedControl
              segments={segments}
              value={group}
              onChange={(next) => {
                setGroup(next);
                setKept(new Set());
              }}
              aria-label="Filtrar personas del embudo"
              mobileGrid
            />
          ) : undefined
        }
      />

      {!config.enabled ? (
        <Alert variant="warning">
          <TriangleAlert aria-hidden />
          <AlertTitle>La página pública está cerrada</AlertTitle>
          <AlertDescription>
            <span className="block">
              Ahora mismo en /llamada no se puede agendar: se invita a escribir por WhatsApp.
              {canManageTeam ? "" : " Solo la dueña de la cuenta puede abrirla."}
            </span>
            {canManageTeam ? (
              <Button variant="outline" size="sm" className="mt-2" disabled={savingConfig} onClick={() => togglePage(true)}>
                Abrir la página
              </Button>
            ) : null}
          </AlertDescription>
        </Alert>
      ) : null}

      {loadedRows === null || stats === null ? (
        reloading ? (
          <div className="overflow-hidden rounded-xl border border-border">
            <CrmLoadingState rows={5} />
          </div>
        ) : (
          <CrmErrorState
            title="No se pudo cargar el embudo"
            message="Inténtalo de nuevo en un momento."
            onRetry={() => startReload(() => router.refresh())}
          />
        )
      ) : rows.length === 0 ? (
        <CrmEmptyState
          icon={PhoneIncoming}
          title="Todavía nadie ha pedido su llamada"
          description="Cuando alguien deje su nombre y su WhatsApp en la página de la llamada gratis, aparece aquí con el paso en el que va."
          action={<CrmPublicLink href={PUBLIC_PATH} label="Abrir la página de la llamada" />}
        />
      ) : (
        <>
          <FunnelSummary stats={stats} toFollowUp={toFollowUp} />

          <CrmFilterBar count={`${filtered.length.toLocaleString("es-CO")} de ${rows.length.toLocaleString("es-CO")}`}>
            <CrmSearchInput value={query} onChange={setQuery} placeholder="Buscar por nombre o número…" />
            {channels.length > 1 ? (
              <Select
                value={channel}
                onValueChange={(next) => {
                  if (typeof next === "string") setChannel(next as Channel | typeof ALL_CHANNELS);
                }}
              >
                <SelectTrigger aria-label="De dónde llegó" className="w-full sm:w-52">
                  <SelectValue>
                    {(value) => (value === ALL_CHANNELS ? "Llegó de cualquier sitio" : (channels.find((c) => c.channel === value)?.label ?? String(value)))}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_CHANNELS}>Llegó de cualquier sitio</SelectItem>
                  {channels.map((c) => (
                    <SelectItem key={c.channel} value={c.channel}>
                      {c.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : null}
          </CrmFilterBar>

          {filtered.length === 0 ? (
            <CrmEmptyState
              icon={PhoneIncoming}
              title={group === "seguimiento" && !query && channel === ALL_CHANNELS ? "No hay nadie por escribirle" : "Nadie encaja con este filtro"}
              description={
                group === "seguimiento" && !query && channel === ALL_CHANNELS
                  ? "Todas las personas sin llamada ya tienen su seguimiento."
                  : "Prueba con otro grupo o limpia la búsqueda."
              }
            />
          ) : (
            <CrmDataList>
              {filtered.map((r) => {
                const followable = needsFollowUp(r.stage);
                const waUrl = followable ? buildContactWhatsAppUrl(r.phoneE164, inviteMessage(r, publicUrl)) : null;
                return (
                  <CrmDataListRow
                    key={r.id}
                    actions={
                      <CrmRowActions>
                        {r.conversationId ? (
                          <CrmRowAction
                            icon={MessagesSquare}
                            label={`Abrir el chat de ${r.name} en el CRM`}
                            onClick={() => router.push(`/admin/whatsapp?conversation=${encodeURIComponent(r.conversationId ?? "")}`)}
                          />
                        ) : null}
                        <CrmRowAction
                          icon={UserRound}
                          label={`Abrir la ficha de ${r.name}`}
                          onClick={() => router.push(`/admin/contacts/${encodeURIComponent(r.contactId)}`)}
                        />
                        {waUrl ? (
                          <CrmRowAction
                            icon={Send}
                            label={`Escribirle a ${r.name} por WhatsApp`}
                            onClick={() => window.open(waUrl, "_blank", "noopener,noreferrer")}
                          />
                        ) : null}
                      </CrmRowActions>
                    }
                  >
                    <div className="min-w-0 flex-1 basis-64">
                      <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <Link href={`/admin/contacts/${encodeURIComponent(r.contactId)}`} className="font-medium text-foreground hover:underline">
                          {r.name}
                        </Link>
                        <Badge variant="outline" className={STAGE_TONE[r.stage]}>
                          {r.stageLabel}
                        </Badge>
                      </p>
                      <p className="mt-0.5 text-xs text-muted-foreground [overflow-wrap:anywhere]">
                        {r.phoneE164} · llegó {r.cameLabel} · {r.channelLabel}
                        {r.campaign ? ` · campaña ${r.campaign}` : ""}
                        {r.visits > 1 ? ` · vino ${r.visits} veces` : ""}
                      </p>
                      {r.topic || r.urgency ? (
                        <p className="mt-1 text-sm [overflow-wrap:anywhere]">{[r.topic, r.urgency].filter(Boolean).join(" · ")}</p>
                      ) : null}
                      {r.note ? <Note text={r.note} /> : null}
                      {r.callLabel || r.confirmed ? (
                        <p className="mt-1 flex flex-wrap gap-1.5">
                          {r.callLabel ? (
                            <Badge variant="outline" className="h-auto whitespace-normal">
                              Llamada: {r.callLabel}
                            </Badge>
                          ) : null}
                          {r.confirmed ? (
                            <Badge variant="outline" className="border-success/40 text-success">
                              Confirmó por WhatsApp
                            </Badge>
                          ) : null}
                        </p>
                      ) : null}
                    </div>
                    {followable ? (
                      canWrite ? (
                        <Select
                          value={r.followUp}
                          onValueChange={(value) => {
                            if (typeof value === "string" && value !== r.followUp) void saveFollowUp(r, value as FollowUp);
                          }}
                        >
                          <SelectTrigger size="sm" aria-label={`Seguimiento de ${r.name}`} className="w-40 shrink-0">
                            <SelectValue>{(value) => FOLLOW_UP_LABEL[value as FollowUp] ?? String(value)}</SelectValue>
                          </SelectTrigger>
                          <SelectContent>
                            {(Object.keys(FOLLOW_UP_LABEL) as FollowUp[]).map((f) => (
                              <SelectItem key={f} value={f}>
                                {FOLLOW_UP_LABEL[f]}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <Badge variant="secondary">{FOLLOW_UP_LABEL[r.followUp]}</Badge>
                      )
                    ) : null}
                  </CrmDataListRow>
                );
              })}
            </CrmDataList>
          )}
        </>
      )}

      <FunnelSettings
        value={config}
        saving={savingConfig}
        canWrite={canWrite}
        canOpenClose={canManageTeam}
        onToggle={togglePage}
        onChange={(patch) =>
          void saveConfig(
            patch,
            patch.days != null
              ? `Se muestran ${patch.days === 1 ? "1 día" : `${patch.days} días`}.`
              : `Se ofrecen ${patch.perDay} horas por día.`
          )
        }
      />
    </CrmPageShell>
  );
};

export default EmbudoPageClient;
