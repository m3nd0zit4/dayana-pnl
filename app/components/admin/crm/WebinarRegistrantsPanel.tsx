"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, Check, Minus, RotateCw, X } from "lucide-react";
import { Button } from "@/app/components/ui/button";
import { Switch } from "@/app/components/ui/switch";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/app/components/ui/card";
import { useCrm } from "@/app/components/admin/crm/CrmProvider";
import {
  CrmEmptyState,
  CrmFilterBar,
  CrmLoadMore,
  CrmSearchInput,
} from "@/app/components/admin/crm/ui";

/** Fila serializable — la página la aplana antes de pasarla al cliente. */
export type WebinarRegistrantRow = {
  id: string;
  contactId: string;
  name: string;
  email: string | null;
  phoneE164: string | null;
  notifyEmail: boolean;
  createdAtIso: string;
  linkEmailSentAt: string | null;
  reminder24hSentAt: string | null;
  reminder1hSentAt: string | null;
  lastSendError: string | null;
  lastSendErrorAt: string | null;
  notifyWhatsapp: boolean;
  reminder24hWaSentAt: string | null;
  reminder1hWaSentAt: string | null;
  waReminderError: string | null;
  /** Confirmación por WhatsApp al inscribirse. */
  confirmationWaSentAt?: string | null;
  confirmationWaError?: string | null;
};

export type WebinarRegistrationStats = {
  total: number;
  linkSent: number;
  reminder24h: number;
  reminder1h: number;
  unreachable: number;
  pendingLink: number;
  failed: number;
  wa24h: number;
  wa1h: number;
  waFailed: number;
  noWhatsApp: number;
  waConfirmation?: number;
};

export type MailPass = "link" | "24h" | "1h";

type WaPass = "24h" | "1h";

/** Recordatorios por WhatsApp: el interruptor y si Meta aprobó la plantilla. */
export type EventWhatsAppState = {
  enabled: boolean;
  /** `APPROVED`, `PENDING`, `REJECTED · …` o null si nunca se creó. */
  templateStatus: string | null;
};

type Props = {
  /** El evento que se muestra. */
  webinarId: string;
  /**
   * Base de las rutas: `/api/admin/eventos/<id>` (las de este evento). La
   * vieja `/api/admin/webinar` trabaja sobre el evento actual.
   */
  apiBase?: string;
  registrations: WebinarRegistrantRow[];
  stats: WebinarRegistrationStats;
  /** OWNER puede reenviar a todas; el resto solo individual y pendientes. */
  canBroadcast?: boolean;
  /** Cupo previsto. Solo para avisar al superarlo — no frena nada. */
  capacity?: number | null;
  whatsApp?: EventWhatsAppState;
};

type WaResult = {
  sent: number;
  failed: number;
  skipped: number;
  remaining: number;
  stoppedEarly: boolean;
  reason?: string;
};

type WaPreview = {
  enabled: boolean;
  pending: number;
  text: number;
  template: number;
  skipped: { no_phone: number; opted_out: number; needs_template: number };
  estimatedCost: number;
  currency: string;
  templateApproved: boolean;
};

const WA_STOP_REASON: Record<string, string> = {
  no_event: "No hay evento.",
  inactive: "El evento no está publicado.",
  ended: "El evento ya terminó.",
  no_schedule: "El evento no tiene fecha.",
  no_meet_url: "Falta el enlace de la reunión.",
  disabled: "Los recordatorios por WhatsApp están apagados.",
  outside_window: "Todavía no toca ese recordatorio.",
};

const PAGE = 50;

const PASS_LABEL: Record<MailPass, string> = {
  link: "el enlace",
  "24h": "el recordatorio de 24 h",
  "1h": "el recordatorio de 1 h",
};

const shortDate = (iso: string): string =>
  new Date(iso).toLocaleDateString("es-CO", { day: "numeric", month: "short" });

const SentMark = ({ at, label }: { at: string | null; label: string }) =>
  at ? (
    <span
      title={`${label}: ${new Date(at).toLocaleString("es-CO")}`}
      className="inline-flex items-center gap-1 text-success"
    >
      <Check className="size-3.5" />
      <span className="sr-only">{label} enviado</span>
    </span>
  ) : (
    <span title={`${label}: sin enviar`} className="text-muted-foreground/60">
      <Minus className="size-3.5" />
      <span className="sr-only">{label} sin enviar</span>
    </span>
  );

/** Como `SentMark`, pero el sello de WhatsApp se queda aunque falle. */
const WaMark = ({ at, error, label }: { at: string | null; error: string | null; label: string }) =>
  at && error ? (
    <span title={`${label}: no salió — ${error}`} className="inline-flex items-center gap-1 text-destructive">
      <X className="size-3.5" />
      <span className="sr-only">{label} no salió</span>
    </span>
  ) : (
    <SentMark at={at} label={label} />
  );

/** La pasada a la que corresponde el error: la última que se intentó. */
const failedWaPass = (r: WebinarRegistrantRow): WaPass | null =>
  r.waReminderError ? (r.reminder1hWaSentAt ? "1h" : "24h") : null;

/**
 * Quién se registró, qué correos le llegaron y cuáles fallaron.
 *
 * Antes esto era solo lectura, con el argumento de que cambiar el enlace ya
 * devolvía a todo el mundo a la cola. A escala de 10k eso resultó demasiado
 * romo: reenviar a una sola persona que borró su correo no debería obligar a
 * escribir a las otras 9.999. De ahí el reenvío por fila.
 */
const WebinarRegistrantsPanel = ({
  webinarId,
  apiBase = "/api/admin/webinar",
  registrations: initial,
  stats: initialStats,
  canBroadcast = false,
  capacity = null,
  whatsApp = { enabled: true, templateStatus: null },
}: Props) => {
  const { toast, confirm } = useCrm();
  const [rows, setRows] = useState(initial);
  const [stats, setStats] = useState(initialStats);
  const [q, setQ] = useState("");
  const [failedOnly, setFailedOnly] = useState(false);
  const [hasMore, setHasMore] = useState(initial.length >= PAGE);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [waEnabled, setWaEnabled] = useState(whatsApp.enabled);
  const [waToggling, setWaToggling] = useState(false);
  /** Pasada de WhatsApp en curso y lo que lleva, mientras la página repite. */
  const [waRun, setWaRun] = useState<{ pass: WaPass; sent: number; notSent: number; remaining: number } | null>(
    null
  );
  const templateApproved = (whatsApp.templateStatus ?? "").toUpperCase() === "APPROVED";
  // El servidor ya pinto la primera pagina: sin esto el efecto de busqueda
  // dispara otra consulta identica en cuanto monta, en cada visita.
  const firstRender = useRef(true);

  const fetchPage = useCallback(
    async (skip: number, search: string, onlyFailed: boolean) => {
      const params = new URLSearchParams({
        take: String(PAGE),
        skip: String(skip),
        webinarId,
      });
      if (search.trim()) params.set("q", search.trim());
      if (onlyFailed) params.set("failedOnly", "true");
      const res = await fetch(`${apiBase}/registrations?${params}`);
      if (!res.ok) throw new Error("load_failed");
      return (await res.json()) as {
        registrations: WebinarRegistrantRow[];
        stats: WebinarRegistrationStats | null;
        hasMore: boolean;
      };
    },
    [webinarId, apiBase]
  );

  // Búsqueda con retardo: filtrar al escribir es la regla del contrato, pero
  // sin esperar un poco serían diez consultas por palabra.
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    const id = setTimeout(async () => {
      setLoading(true);
      try {
        const data = await fetchPage(0, q, failedOnly);
        setRows(data.registrations);
        setHasMore(data.hasMore);
        if (data.stats) setStats(data.stats);
      } catch {
        toast("No se pudo cargar la lista");
      } finally {
        setLoading(false);
      }
    }, 300);
    return () => clearTimeout(id);
  }, [q, failedOnly, fetchPage, toast]);

  const loadMore = async () => {
    setLoading(true);
    try {
      const data = await fetchPage(rows.length, q, failedOnly);
      setRows((prev) => [...prev, ...data.registrations]);
      setHasMore(data.hasMore);
    } catch {
      toast("No se pudo cargar más");
    } finally {
      setLoading(false);
    }
  };

  const refresh = async () => {
    const data = await fetchPage(0, q, failedOnly).catch(() => null);
    if (!data) return;
    setRows(data.registrations);
    setHasMore(data.hasMore);
    if (data.stats) setStats(data.stats);
  };

  const resend = async (
    scope: "one" | "pending" | "all",
    pass: MailPass,
    registrationId?: string
  ) => {
    if (registrationId) setBusyId(registrationId);
    try {
      const res = await fetch(`${apiBase}/registrations/resend`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope, pass, registrationId }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        outcome?: string;
        reason?: string;
        sent?: number;
        failed?: number;
        skipped?: boolean;
        errorMessage?: string | null;
      };
      if (!res.ok) {
        toast(
          res.status === 429
            ? "Demasiados envios seguidos. Espera unos minutos."
            : res.status === 403
              ? "Solo la dueña de la cuenta puede reenviar a todas."
              : data.errorMessage ||
                {
                  unreachable: "Esa persona no tiene correo o se dio de baja.",
                  no_meet_url: "Todavía no hay enlace de reunión que enviar.",
                  wrong_webinar: "Esa inscripción es de un evento ya realizado.",
                  notifications_disabled: "Las notificaciones están apagadas.",
                }[data.reason ?? ""] ||
                "No se pudo reenviar."
        );
        return;
      }
      // Un barrido puede no enviar nada por un motivo perfectamente normal:
      // decirlo evita que parezca que el boton no hace nada.
      const skipReason: Record<string, string> = {
        outside_window:
          "Todavia no toca ese recordatorio: se envia dentro de su ventana.",
        no_pending_recipients: "Ya lo tienen todas.",
        no_meet_url: "Falta el enlace de la reunion.",
        inactive: "El webinar no esta activo.",
        notifications_disabled: "Las notificaciones estan apagadas.",
        ended: "Este evento ya pasó: no se envía nada a todas.",
      };
      toast(
        scope === "one"
          ? data.outcome === "claimed_elsewhere"
            ? "Ya se estaba enviando en este momento"
            : "Reenviado"
          : data.skipped
            ? (skipReason[data.reason ?? ""] ?? "No habia nada que enviar")
            : // Los fallos tienen que verse: si solo se anuncia el exito, un
              // corte del proveedor (cuota diaria agotada, por ejemplo) pasa
              // por envio correcto y nadie se entera de quien se quedo fuera.
              data.failed
              ? `Enviado a ${data.sent ?? 0}. ${data.failed} fallaron — filtra por «Solo fallidas» para verlas.`
              : `Enviado a ${data.sent ?? 0} personas`,
        data.failed ? "error" : undefined
      );
      await refresh();
    } finally {
      setBusyId(null);
    }
  };

  const confirmResendAll = (pass: MailPass) => {
    confirm({
      title: "Reenviar a todas",
      message: `Esto enviará ${stats.total.toLocaleString("es-CO")} correos con ${PASS_LABEL[pass]}, incluidas las personas que ya lo recibieron.`,
      confirmLabel: "Reenviar a todas",
      destructive: true,
      onConfirm: () => resend("all", pass),
    });
  };

  const waEndpoint = `${apiBase}/registrations/whatsapp`;

  const postWa = async (body: { scope: "pending" | "one"; pass: WaPass; registrationId?: string }) => {
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
          : data.error === "wrong_webinar"
            ? "Esa inscripción es de otro evento."
            : "No se pudo enviar por WhatsApp."
      );
    }
    return data as WaResult;
  };

  /**
   * Cada llamada envía unos 50 s; la página repite hasta vaciar la cola. Si se
   * cierra a medias no pasa nada: lo enviado queda sellado y el resto sale en
   * la siguiente pulsación (o con el reloj).
   */
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
    if (!p) {
      toast("No se pudo preparar el envío.", "error");
      return;
    }
    if (p.pending === 0) {
      toast("Ya lo tienen todas las que tienen WhatsApp.");
      return;
    }
    const cost =
      p.template > 0 && p.estimatedCost > 0
        ? ` (unos ${p.estimatedCost.toLocaleString("es-CO")} ${p.currency})`
        : "";
    const parts = [
      `Le llegará el recordatorio de ${pass === "24h" ? "24 h" : "1 h"} a ${p.text + p.template} personas:`,
      `${p.text} gratis (escribieron en las últimas 24 h) y ${p.template} con la plantilla${cost}.`,
      p.skipped.needs_template
        ? `${p.skipped.needs_template} no se pueden: la plantilla no está aprobada y no han escrito.`
        : "",
      "Nadie lo recibe dos veces.",
    ];
    confirm({
      title: "Recordatorio por WhatsApp",
      message: parts.filter(Boolean).join(" "),
      confirmLabel: "Enviar",
      onConfirm: () => runWaPass(pass),
    });
  };

  const retryWa = async (r: WebinarRegistrantRow) => {
    const pass = failedWaPass(r);
    if (!pass) return;
    setBusyId(r.id);
    try {
      const res = await postWa({ scope: "one", pass, registrationId: r.id });
      toast(
        res.sent
          ? "Enviado por WhatsApp"
          : res.reason
            ? (WA_STOP_REASON[res.reason] ?? "No salió.")
            : "No salió: mira el motivo en la fila.",
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

  return (
    <Card className="border-border bg-card">
      <CardHeader className="flex flex-row items-center justify-between gap-3">
        <CardTitle className="text-base uppercase tracking-wide">
          Registradas
        </CardTitle>
        <span className="flex items-center gap-2">
          {stats.total > 0 ? (
            <Link
              href={`/admin/eventos/${encodeURIComponent(webinarId)}?tab=whatsapp`}
              className="inline-flex h-8 items-center gap-1.5 rounded-full bg-[#00a884] px-3 text-xs font-medium text-white hover:bg-[#008069]"
            >
              Enviar por WhatsApp
            </Link>
          ) : null}
          <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
            {stats.total.toLocaleString("es-CO")}
          </span>
        </span>
      </CardHeader>
      <CardContent className="space-y-4">
        {stats.total > 0 ? (
          <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {(
              [
                ["Enlace enviado", stats.linkSent],
                ["Recordatorio 24 h", stats.reminder24h],
                ["Recordatorio 1 h", stats.reminder1h],
                ["Sin correo / baja", stats.unreachable],
                ["WhatsApp 24 h", stats.wa24h],
                ["WhatsApp 1 h", stats.wa1h],
                ["Confirmación WA", stats.waConfirmation ?? 0],
                ["Sin WhatsApp", stats.noWhatsApp],
              ] as const
            ).map(([label, value]) => (
              <div
                key={label}
                className="rounded-xl border border-border bg-muted/40 px-3 py-2"
              >
                <dt className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  {label}
                </dt>
                <dd className="mt-0.5 text-base font-semibold text-foreground">
                  {value.toLocaleString("es-CO")}
                </dd>
              </div>
            ))}
          </dl>
        ) : null}

        {capacity && stats.total > capacity ? (
          <p className="rounded-xl border border-warning/30 bg-warning/5 px-3 py-2 text-xs text-warning">
            Se superó el cupo previsto de {capacity.toLocaleString("es-CO")}:
            hay {stats.total.toLocaleString("es-CO")} registradas. No se ha
            cerrado nada — todas siguen recibiendo el enlace. Revisa que la sala
            aguante ese número.
          </p>
        ) : null}

        {stats.failed > 0 ? (
          <p className="flex items-center gap-2 rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
            <AlertTriangle className="size-3.5 shrink-0" />
            {stats.failed.toLocaleString("es-CO")} con envíos fallidos. Se
            reintentan solos en el próximo barrido; el botón fuerza el reenvío
            ahora.
          </p>
        ) : null}

        {stats.total > 0 ? (
          <>
            <CrmFilterBar
              count={`${rows.length} de ${stats.total.toLocaleString("es-CO")}`}
            >
              <CrmSearchInput
                value={q}
                onChange={setQ}
                placeholder="Buscar por nombre, correo o teléfono"
              />
              <Button
                type="button"
                variant={failedOnly ? "default" : "outline"}
                size="sm"
                onClick={() => setFailedOnly((v) => !v)}
              >
                Solo fallidas
              </Button>
            </CrmFilterBar>

            <div className="space-y-2">
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={stats.pendingLink === 0}
                  onClick={() => void resend("pending", "link")}
                >
                  <RotateCw className="size-3.5" />
                  Enviar enlace pendiente (
                  {stats.pendingLink.toLocaleString("es-CO")})
                </Button>
                {canBroadcast ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => confirmResendAll("link")}
                  >
                    Reenviar enlace a todas
                  </Button>
                ) : null}
              </div>
              {/* Los recordatorios los manda el cron solo, pero si por lo que
                  sea no ha salido, esto lo dispara a mano sin esperar. */}
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-muted-foreground">
                  Recordatorios por correo:
                </span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => void resend("pending", "24h")}
                >
                  Enviar el de 24 h ahora
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => void resend("pending", "1h")}
                >
                  Enviar el de 1 h ahora
                </Button>
              </div>
            </div>

            {/* WhatsApp: salen solos con el reloj (24 h y 1 h antes). Los
                botones son el respaldo si el reloj no corrió. */}
            <div className="space-y-3 rounded-xl border border-border px-3 py-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground">
                    Recordatorios por WhatsApp
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {waEnabled
                      ? "Salen solos 24 h y 1 h antes, una vez por persona."
                      : "Apagados: no sale ninguno, ni solo ni con los botones."}
                  </p>
                  <p
                    className={`mt-1 text-xs ${templateApproved ? "text-success" : "text-warning"}`}
                    title={whatsApp.templateStatus ?? "Sin plantilla"}
                  >
                    {templateApproved
                      ? "Plantilla aprobada"
                      : "Plantilla pendiente: solo saldrá a quien escribió en 24 h"}
                  </p>
                </div>
                <Switch
                  checked={waEnabled}
                  disabled={waToggling || waRun !== null}
                  onCheckedChange={(v) => void toggleWa(v)}
                  aria-label="Recordatorios por WhatsApp"
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
                    {waRun?.pass === pass
                      ? "Enviando…"
                      : `Por WhatsApp: enviar el de ${pass === "24h" ? "24 h" : "1 h"} ahora`}
                  </Button>
                ))}
              </div>
              {waRun ? (
                <p className="text-xs text-muted-foreground" aria-live="polite">
                  Enviando el de {waRun.pass === "24h" ? "24 h" : "1 h"}:{" "}
                  {waRun.sent.toLocaleString("es-CO")} enviados
                  {waRun.notSent ? ` · ${waRun.notSent.toLocaleString("es-CO")} sin enviar` : ""}
                  {waRun.remaining ? ` · quedan ${waRun.remaining.toLocaleString("es-CO")}` : ""}. No
                  cierres esta página.
                </p>
              ) : null}
              {stats.waFailed > 0 ? (
                <p className="flex items-center gap-2 text-xs text-destructive">
                  <AlertTriangle className="size-3.5 shrink-0" />
                  {stats.waFailed.toLocaleString("es-CO")} sin enviar por
                  WhatsApp. No se reintentan solos: filtra «Solo fallidas» y
                  pulsa «Reintentar WA».
                </p>
              ) : null}
            </div>
          </>
        ) : null}

        {rows.length === 0 ? (
          <CrmEmptyState
            title={
              q || failedOnly
                ? "Nadie coincide con ese filtro"
                : "Todavía nadie se ha registrado"
            }
            description={
              q || failedOnly
                ? "Prueba con otro nombre o quita el filtro."
                : "Cuando alguien se registre en la landing, aparecerá aquí."
            }
          />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[820px] text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                    <th className="pb-2 font-medium">Persona</th>
                    <th className="pb-2 font-medium">Registro</th>
                    <th className="pb-2 text-center font-medium">Enlace</th>
                    <th className="pb-2 text-center font-medium">24 h</th>
                    <th className="pb-2 text-center font-medium">1 h</th>
                    <th className="pb-2 text-center font-medium">WA 24 h</th>
                    <th className="pb-2 text-center font-medium">WA 1 h</th>
                    <th className="pb-2 text-right font-medium">Reenviar</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} className="border-b border-border last:border-0">
                      <td className="py-2.5 pr-3">
                        <Link
                          href={`/admin/contacts/${r.contactId}`}
                          className="font-medium text-foreground hover:text-terracotta"
                        >
                          {r.name}
                        </Link>
                        <div className="mt-0.5 text-xs text-muted-foreground">
                          {r.email ? (
                            r.notifyEmail ? (
                              r.email
                            ) : (
                              <span className="text-warning">
                                {r.email} · baja de correo
                              </span>
                            )
                          ) : (
                            <span className="text-warning">sin correo</span>
                          )}
                          {r.phoneE164 ? ` · ${r.phoneE164}` : ""}
                        </div>
                        {r.lastSendError ? (
                          <div className="mt-1 text-xs text-destructive">
                            Falló: {r.lastSendError}
                          </div>
                        ) : null}
                        {r.confirmationWaError ? (
                          <div className="mt-1 text-xs text-warning">
                            Confirmación por WhatsApp: {r.confirmationWaError}
                          </div>
                        ) : null}
                        {r.waReminderError ? (
                          <div className="mt-1 text-xs text-destructive">
                            WhatsApp no salió: {r.waReminderError}
                          </div>
                        ) : !r.notifyWhatsapp ? (
                          <div className="mt-1 text-xs text-warning">
                            Pidió no recibir WhatsApp
                          </div>
                        ) : null}
                      </td>
                      <td className="py-2.5 pr-3 text-xs text-muted-foreground">
                        {shortDate(r.createdAtIso)}
                      </td>
                      <td className="py-2.5 text-center">
                        <SentMark at={r.linkEmailSentAt} label="Enlace" />
                      </td>
                      <td className="py-2.5 text-center">
                        <SentMark at={r.reminder24hSentAt} label="Recordatorio 24 h" />
                      </td>
                      <td className="py-2.5 text-center">
                        <SentMark at={r.reminder1hSentAt} label="Recordatorio 1 h" />
                      </td>
                      <td className="py-2.5 text-center">
                        <WaMark
                          at={r.reminder24hWaSentAt}
                          error={failedWaPass(r) === "24h" ? r.waReminderError : null}
                          label="WhatsApp 24 h"
                        />
                      </td>
                      <td className="py-2.5 text-center">
                        <WaMark
                          at={r.reminder1hWaSentAt}
                          error={failedWaPass(r) === "1h" ? r.waReminderError : null}
                          label="WhatsApp 1 h"
                        />
                      </td>
                      <td className="py-2.5 text-right">
                        <div className="flex flex-col items-end gap-1">
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            disabled={busyId === r.id || !r.email || !r.notifyEmail}
                            onClick={() => void resend("one", "link", r.id)}
                          >
                            {busyId === r.id ? "Enviando…" : "Enlace"}
                          </Button>
                          {r.waReminderError ? (
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              disabled={busyId === r.id || !waEnabled || waRun !== null}
                              onClick={() => void retryWa(r)}
                            >
                              Reintentar WA
                            </Button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <CrmLoadMore onClick={() => void loadMore()} hasMore={hasMore} loading={loading} />
          </>
        )}

        {stats.unreachable > 0 ? (
          <p className="text-xs text-warning">
            {stats.unreachable.toLocaleString("es-CO")} sin correo o dadas de
            baja: no reciben ni el enlace ni los recordatorios. Envíales el
            enlace por WhatsApp desde «Enviar por WhatsApp».
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
};

export default WebinarRegistrantsPanel;
