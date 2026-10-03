"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, Check, Minus, Users, X } from "lucide-react";
import { Button } from "@/app/components/ui/button";
import { Switch } from "@/app/components/ui/switch";
import type { WorkshopEnrollmentRow, WorkshopEnrollmentStats } from "@/lib/crm/workshop-panel";
import { useCrm } from "../CrmProvider";
import { CrmDataList, CrmDataListRow, CrmEmptyState, CrmFilterBar, CrmLoadMore, CrmSearchInput } from "../ui";
import EditionSection from "../editions/EditionSection";

type WaPass = "24h" | "1h";

type WaResult = {
  sent: number;
  failed: number;
  skipped: number;
  remaining: number;
  stoppedEarly: boolean;
  reason?: string;
};

type WaPreview = {
  pending: number;
  text: number;
  template: number;
  skipped: { no_phone: number; opted_out: number; needs_template: number };
  estimatedCost: number;
  currency: string;
};

type Props = {
  slug: string;
  enrollments: WorkshopEnrollmentRow[];
  stats: WorkshopEnrollmentStats;
  whatsApp: { enabled: boolean; templateStatus: string | null };
  /** Lo que le falta para que salgan los recordatorios, si algo. */
  blockedReason: string | null;
};

const PAGE = 50;

const WA_STOP_REASON: Record<string, string> = {
  no_event: "No encontré el taller.",
  inactive: "El taller no está publicado ni con inscripciones cerradas.",
  ended: "El taller ya terminó.",
  no_schedule: "El taller no tiene fecha.",
  no_meet_url: "Falta el enlace de la reunión (pestaña «Página»).",
  disabled: "Los recordatorios por WhatsApp de los talleres están apagados.",
  outside_window: "Todavía no toca ese recordatorio.",
};

const Mark = ({ at, error, label }: { at: string | null; error?: string | null; label: string }) =>
  at && error ? (
    <span title={`${label}: no salió — ${error}`} className="inline-flex items-center gap-0.5 text-destructive">
      <X className="size-3.5" aria-hidden />
      {label}
    </span>
  ) : at ? (
    <span title={`${label}: ${new Date(at).toLocaleString("es-CO")}`} className="inline-flex items-center gap-0.5 text-success">
      <Check className="size-3.5" aria-hidden />
      {label}
    </span>
  ) : (
    <span title={`${label}: sin enviar`} className="inline-flex items-center gap-0.5 text-muted-foreground">
      <Minus className="size-3.5" aria-hidden />
      {label}
    </span>
  );

/** Las pasadas de WhatsApp que no salieron, cada una con su motivo. */
const failedWaPasses = (r: WorkshopEnrollmentRow): { pass: WaPass; error: string }[] =>
  [
    r.waReminderError ? { pass: "24h" as const, error: r.waReminderError } : null,
    r.waReminder1hError ? { pass: "1h" as const, error: r.waReminder1hError } : null,
  ].filter((x): x is { pass: WaPass; error: string } => x !== null);

/**
 * La pestaña «Inscritas» de un taller: quién pagó, qué recordatorios le
 * llegaron (correo y WhatsApp) y los botones para mandar a mano el de 24 h o
 * el de 1 h si el reloj no corrió — como en los eventos. Nadie lo recibe dos
 * veces: cada persona se sella antes de enviar.
 */
const WorkshopEnrollmentsPanel = ({ slug, enrollments, stats: initialStats, whatsApp, blockedReason }: Props) => {
  const { toast, confirm } = useCrm();
  const apiBase = `/api/admin/workshops/${encodeURIComponent(slug)}`;
  const [rows, setRows] = useState(enrollments);
  const [stats, setStats] = useState(initialStats);
  const [q, setQ] = useState("");
  const [failedOnly, setFailedOnly] = useState(false);
  const [hasMore, setHasMore] = useState(enrollments.length >= PAGE);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [waEnabled, setWaEnabled] = useState(whatsApp.enabled);
  const [waToggling, setWaToggling] = useState(false);
  const [waRun, setWaRun] = useState<{ pass: WaPass; sent: number; notSent: number; remaining: number } | null>(null);
  const templateApproved = (whatsApp.templateStatus ?? "").toUpperCase() === "APPROVED";
  const firstRender = useRef(true);

  const fetchPage = useCallback(
    async (skip: number, search: string, onlyFailed: boolean) => {
      const params = new URLSearchParams({ take: String(PAGE), skip: String(skip) });
      if (search.trim()) params.set("q", search.trim());
      if (onlyFailed) params.set("failedOnly", "true");
      const res = await fetch(`${apiBase}/enrollments?${params}`);
      if (!res.ok) throw new Error("load_failed");
      return (await res.json()) as {
        enrollments: WorkshopEnrollmentRow[];
        stats: WorkshopEnrollmentStats | null;
        hasMore: boolean;
      };
    },
    [apiBase]
  );

  // Se filtra al escribir (contrato R10), con un respiro para no consultar por letra.
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    const id = setTimeout(async () => {
      setLoading(true);
      try {
        const data = await fetchPage(0, q, failedOnly);
        setRows(data.enrollments);
        setHasMore(data.hasMore);
        if (data.stats) setStats(data.stats);
      } catch {
        toast("No se pudo cargar la lista", "error");
      } finally {
        setLoading(false);
      }
    }, 300);
    return () => clearTimeout(id);
  }, [q, failedOnly, fetchPage, toast]);

  const refresh = async () => {
    const data = await fetchPage(0, q, failedOnly).catch(() => null);
    if (!data) return;
    setRows(data.enrollments);
    setHasMore(data.hasMore);
    if (data.stats) setStats(data.stats);
  };

  const loadMore = async () => {
    setLoading(true);
    try {
      const data = await fetchPage(rows.length, q, failedOnly);
      setRows((prev) => [...prev, ...data.enrollments]);
      setHasMore(data.hasMore);
    } catch {
      toast("No se pudo cargar más", "error");
    } finally {
      setLoading(false);
    }
  };

  const waEndpoint = `${apiBase}/enrollments/whatsapp`;

  const postWa = async (body: { scope: "pending" | "one"; pass: WaPass; enrollmentId?: string }) => {
    const res = await fetch(waEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = (await res.json().catch(() => ({}))) as Partial<WaResult> & { error?: string };
    if (!res.ok) {
      throw new Error(
        res.status === 429
          ? "Demasiados envíos seguidos. Espera unos minutos."
          : data.error === "wrong_edition"
            ? "Esa inscripción es de otro taller."
            : "No se pudo enviar por WhatsApp."
      );
    }
    return data as WaResult;
  };

  /** Cada llamada envía unos 50 s; la página repite hasta vaciar la cola. */
  const runWaPass = async (pass: WaPass) => {
    const totals = { sent: 0, notSent: 0, remaining: 0 };
    setWaRun({ pass, ...totals });
    try {
      for (let i = 0; i < 40; i += 1) {
        const r = await postWa({ scope: "pending", pass });
        totals.sent += r.sent;
        totals.notSent += r.failed + r.skipped;
        totals.remaining = r.remaining;
        setWaRun({ pass, ...totals });
        if (r.reason) {
          toast(WA_STOP_REASON[r.reason] ?? "No se envió nada.", "error");
          return;
        }
        const progressed = r.sent + r.failed + r.skipped > 0;
        if (!r.stoppedEarly && !(r.remaining > 0 && progressed)) break;
      }
      toast(
        totals.notSent
          ? `WhatsApp: ${totals.sent} enviados, ${totals.notSent} sin enviar — filtra «Solo fallidas» para ver el motivo.`
          : `WhatsApp: ${totals.sent} enviados.`,
        totals.notSent ? "error" : undefined
      );
    } catch (e) {
      toast(e instanceof Error ? e.message : "No se pudo enviar por WhatsApp.", "error");
    } finally {
      setWaRun(null);
      await refresh();
    }
  };

  const confirmWaPass = async (pass: WaPass) => {
    const res = await fetch(`${waEndpoint}?pass=${pass}`).catch(() => null);
    const p = res?.ok ? ((await res.json()) as WaPreview) : null;
    if (!p) return void toast("No se pudo preparar el envío.", "error");
    if (p.pending === 0) return void toast("Ya lo tienen todas las que tienen WhatsApp.");
    const cost =
      p.template > 0 && p.estimatedCost > 0 ? ` (unos ${p.estimatedCost.toLocaleString("es-CO")} ${p.currency})` : "";
    confirm({
      title: "Recordatorio por WhatsApp",
      message: [
        `Le llegará el recordatorio de ${pass === "24h" ? "24 h" : "1 h"}, con el enlace de la reunión, a ${p.text + p.template} personas:`,
        `${p.text} gratis (escribieron en las últimas 24 h) y ${p.template} con la plantilla${cost}.`,
        p.skipped.needs_template
          ? `${p.skipped.needs_template} no se pueden: la plantilla no está aprobada y no han escrito.`
          : "",
        "Nadie lo recibe dos veces.",
      ]
        .filter(Boolean)
        .join(" "),
      confirmLabel: "Enviar",
      onConfirm: () => runWaPass(pass),
    });
  };

  const retryWa = async (r: WorkshopEnrollmentRow, pass: WaPass) => {
    setBusyId(r.id);
    try {
      const res = await postWa({ scope: "one", pass, enrollmentId: r.id });
      toast(
        res.sent ? "Enviado por WhatsApp" : res.reason ? (WA_STOP_REASON[res.reason] ?? "No salió.") : "No salió: mira el motivo en la fila.",
        res.sent ? undefined : "error"
      );
    } catch (e) {
      toast(e instanceof Error ? e.message : "No se pudo enviar por WhatsApp.", "error");
    } finally {
      setBusyId(null);
      await refresh();
    }
  };

  const toggleWa = async (enabled: boolean) => {
    setWaToggling(true);
    try {
      const res = await fetch(waEndpoint, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      if (!res.ok) throw new Error();
      setWaEnabled(enabled);
      toast(enabled ? "Recordatorios por WhatsApp encendidos" : "Recordatorios por WhatsApp apagados");
    } catch {
      toast("No se pudo cambiar.", "error");
    } finally {
      setWaToggling(false);
    }
  };

  /** Cuatro casillas, no ocho: en el teléfono la lista tiene que verse pronto. */
  const statCells: [string, string, string | null][] = [
    ["Pagaron", stats.total.toLocaleString("es-CO"), null],
    ["Correo", `${stats.email24h} · ${stats.email1h}`, "24 h · 1 h"],
    ["WhatsApp", `${stats.wa24h} · ${stats.wa1h}`, "24 h · 1 h"],
    [
      "No les llega",
      `${stats.waFailed + stats.noWhatsApp} · ${stats.noEmail}`,
      "WhatsApp · correo",
    ],
  ];

  if (stats.total === 0 && !q && !failedOnly) {
    return (
      <CrmEmptyState
        icon={Users}
        title="Todavía nadie ha pagado"
        description="Cuando alguien pague este taller aparecerá aquí con sus recordatorios."
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {statCells.map(([label, value, hint]) => (
          <div key={label} className="rounded-xl border border-border bg-card px-3 py-2">
            <dt className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</dt>
            <dd className="mt-0.5 text-base font-semibold tabular-nums text-foreground">
              {value}
              {hint ? <span className="ml-1.5 text-[10px] font-normal text-muted-foreground">{hint}</span> : null}
            </dd>
          </div>
        ))}
      </dl>

      {blockedReason ? <p className="text-xs text-warning">{blockedReason}</p> : null}
      {stats.waFailed > 0 ? (
        <p className="flex items-center gap-2 text-xs text-destructive">
          <AlertTriangle className="size-3.5 shrink-0" aria-hidden />
          {stats.waFailed.toLocaleString("es-CO")} sin enviar por WhatsApp. No se reintentan solos: filtra «Solo
          fallidas» y pulsa «Reintentar WA».
        </p>
      ) : null}

      {/* Salen solos con el reloj (24 h y 1 h antes). Los botones son el
          respaldo si el reloj no corrió. En el teléfono, plegado. */}
      <EditionSection
        title="Recordatorios por WhatsApp"
        summary={`${waEnabled ? "Encendidos" : "Apagados"} · plantilla ${templateApproved ? "aprobada" : "pendiente"}`}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground">
              {waEnabled
                ? "Salen solos 24 h y 1 h antes, con el enlace de la reunión, una vez por persona."
                : "Apagados para todos los talleres: no sale ninguno, ni solo ni con los botones."}
            </p>
            <p
              className={`mt-1 text-xs ${templateApproved ? "text-success" : "text-warning"}`}
              title={whatsApp.templateStatus ?? "Sin plantilla"}
            >
              {templateApproved
                ? "Plantilla «taller_recordatorio» aprobada"
                : "Plantilla «taller_recordatorio» pendiente: solo saldrá a quien escribió en 24 h"}
            </p>
          </div>
          <Switch
            checked={waEnabled}
            disabled={waToggling || waRun !== null}
            onCheckedChange={(v) => void toggleWa(v)}
            aria-label="Recordatorios por WhatsApp de los talleres"
          />
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          {(["24h", "1h"] as const).map((pass) => (
            <Button
              key={pass}
              type="button"
              variant="outline"
              size="sm"
              className="justify-start sm:justify-center"
              disabled={!waEnabled || waRun !== null}
              onClick={() => void confirmWaPass(pass)}
            >
              {waRun?.pass === pass ? "Enviando…" : `Enviar el de ${pass === "24h" ? "24 h" : "1 h"} ahora`}
            </Button>
          ))}
        </div>
        {waRun ? (
          <p className="text-xs text-muted-foreground" aria-live="polite">
            Enviando el de {waRun.pass === "24h" ? "24 h" : "1 h"}: {waRun.sent.toLocaleString("es-CO")} enviados
            {waRun.notSent ? ` · ${waRun.notSent.toLocaleString("es-CO")} sin enviar` : ""}
            {waRun.remaining ? ` · quedan ${waRun.remaining.toLocaleString("es-CO")}` : ""}. No cierres esta página.
          </p>
        ) : null}
        <p className="text-xs text-muted-foreground">
          Los recordatorios por correo (24 h y 1 h) salen solos con el reloj a quien tiene correo.
        </p>
      </EditionSection>

      <CrmFilterBar count={`${rows.length} de ${stats.total.toLocaleString("es-CO")}`}>
        <CrmSearchInput value={q} onChange={setQ} placeholder="Buscar por nombre, correo o teléfono" />
        <Button
          type="button"
          variant={failedOnly ? "default" : "outline"}
          size="sm"
          onClick={() => setFailedOnly((v) => !v)}
        >
          Solo fallidas
        </Button>
      </CrmFilterBar>

      {rows.length === 0 ? (
        <CrmEmptyState title="Nadie coincide con ese filtro" description="Prueba con otro nombre o quita el filtro." />
      ) : (
        <>
          <CrmDataList>
            {rows.map((r) => (
              <CrmDataListRow
                key={r.id}
                actions={
                  failedWaPasses(r).length > 0 ? (
                    <div className="flex flex-col items-end gap-1">
                      {failedWaPasses(r).map(({ pass }) => (
                        <Button
                          key={pass}
                          type="button"
                          variant="ghost"
                          size="sm"
                          disabled={busyId === r.id || !waEnabled || waRun !== null}
                          onClick={() => void retryWa(r, pass)}
                        >
                          Reintentar WA {pass === "24h" ? "24 h" : "1 h"}
                        </Button>
                      ))}
                    </div>
                  ) : undefined
                }
              >
                <div className="min-w-0 flex-1">
                  <Link href={`/admin/contacts/${r.contactId}`} className="font-medium text-foreground hover:underline">
                    {r.name}
                  </Link>
                  <p className="mt-0.5 text-xs text-muted-foreground [overflow-wrap:anywhere]">
                    {r.email ? (
                      r.notifyEmail ? (
                        r.email
                      ) : (
                        <span className="text-warning">{r.email} · baja de correo</span>
                      )
                    ) : (
                      <span className="text-warning">sin correo</span>
                    )}
                    {r.phoneE164 ? ` · ${r.phoneE164}` : ""} · pagó el{" "}
                    {new Date(r.paidAtIso).toLocaleDateString("es-CO", { day: "numeric", month: "short" })}
                  </p>
                  <p className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px]">
                    <Mark at={r.reminder24hSentAt} label="Correo 24 h" />
                    <Mark at={r.reminder1hSentAt} label="Correo 1 h" />
                    <Mark at={r.reminder24hWaSentAt} error={r.waReminderError} label="WA 24 h" />
                    <Mark at={r.reminder1hWaSentAt} error={r.waReminder1hError} label="WA 1 h" />
                  </p>
                  {failedWaPasses(r).length > 0 ? (
                    failedWaPasses(r).map(({ pass, error }) => (
                      <p key={pass} className="mt-1 text-xs text-destructive">
                        WhatsApp {pass === "24h" ? "24 h" : "1 h"} no salió: {error}
                      </p>
                    ))
                  ) : !r.notifyWhatsapp ? (
                    <p className="mt-1 text-xs text-warning">Pidió no recibir WhatsApp</p>
                  ) : null}
                </div>
              </CrmDataListRow>
            ))}
          </CrmDataList>
          <CrmLoadMore onClick={() => void loadMore()} hasMore={hasMore} loading={loading} />
        </>
      )}
    </div>
  );
};

export default WorkshopEnrollmentsPanel;
