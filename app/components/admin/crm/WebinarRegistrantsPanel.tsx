"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Check, Minus, RotateCw } from "lucide-react";
import { Button } from "@/app/components/ui/button";
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
};

export type WebinarRegistrationStats = {
  total: number;
  linkSent: number;
  reminder24h: number;
  reminder1h: number;
  unreachable: number;
  pendingLink: number;
  failed: number;
};

export type MailPass = "link" | "24h" | "1h";

type Props = {
  registrations: WebinarRegistrantRow[];
  stats: WebinarRegistrationStats;
  /** OWNER puede reenviar a todas; el resto solo individual y pendientes. */
  canBroadcast?: boolean;
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

/**
 * Quién se registró, qué correos le llegaron y cuáles fallaron.
 *
 * Antes esto era solo lectura, con el argumento de que cambiar el enlace ya
 * devolvía a todo el mundo a la cola. A escala de 10k eso resultó demasiado
 * romo: reenviar a una sola persona que borró su correo no debería obligar a
 * escribir a las otras 9.999. De ahí el reenvío por fila.
 */
const WebinarRegistrantsPanel = ({
  registrations: initial,
  stats: initialStats,
  canBroadcast = false,
}: Props) => {
  const { toast, confirm } = useCrm();
  const [rows, setRows] = useState(initial);
  const [stats, setStats] = useState(initialStats);
  const [q, setQ] = useState("");
  const [failedOnly, setFailedOnly] = useState(false);
  const [hasMore, setHasMore] = useState(initial.length >= PAGE);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const fetchPage = useCallback(
    async (skip: number, search: string, onlyFailed: boolean) => {
      const params = new URLSearchParams({
        take: String(PAGE),
        skip: String(skip),
      });
      if (search.trim()) params.set("q", search.trim());
      if (onlyFailed) params.set("failedOnly", "true");
      const res = await fetch(`/api/admin/webinar/registrations?${params}`);
      if (!res.ok) throw new Error("load_failed");
      return (await res.json()) as {
        registrations: WebinarRegistrantRow[];
        stats: WebinarRegistrationStats | null;
        hasMore: boolean;
      };
    },
    []
  );

  // Búsqueda con retardo: filtrar al escribir es la regla del contrato, pero
  // sin esperar un poco serían diez consultas por palabra.
  useEffect(() => {
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
      const res = await fetch("/api/admin/webinar/registrations/resend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope, pass, registrationId }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        outcome?: string;
        reason?: string;
        sent?: number;
        errorMessage?: string | null;
      };
      if (!res.ok) {
        toast(
          res.status === 429
            ? "Has reenviado demasiadas veces. Espera un poco."
            : res.status === 403
              ? "Solo la dueña de la cuenta puede reenviar a todas."
              : data.errorMessage ||
                {
                  unreachable: "Esa persona no tiene correo o se dio de baja.",
                  no_meet_url: "Todavía no hay enlace de reunión que enviar.",
                  wrong_webinar: "Esa inscripción es de una edición archivada.",
                  notifications_disabled: "Las notificaciones están apagadas.",
                }[data.reason ?? ""] ||
                "No se pudo reenviar."
        );
        return;
      }
      toast(
        scope === "one"
          ? data.outcome === "claimed_elsewhere"
            ? "Ya se estaba enviando en este momento"
            : "Reenviado"
          : `Reenviado a ${data.sent ?? 0} personas`
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

  return (
    <Card className="border-border bg-card">
      <CardHeader className="flex flex-row items-center justify-between gap-3">
        <CardTitle className="text-base uppercase tracking-wide">
          Registradas
        </CardTitle>
        <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
          {stats.total.toLocaleString("es-CO")}
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

            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={stats.pendingLink === 0}
                onClick={() => void resend("pending", "link")}
              >
                <RotateCw className="size-3.5" />
                Enviar pendientes ({stats.pendingLink.toLocaleString("es-CO")})
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
              <table className="w-full min-w-[720px] text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                    <th className="pb-2 font-medium">Persona</th>
                    <th className="pb-2 font-medium">Registro</th>
                    <th className="pb-2 text-center font-medium">Enlace</th>
                    <th className="pb-2 text-center font-medium">24 h</th>
                    <th className="pb-2 text-center font-medium">1 h</th>
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
                      <td className="py-2.5 text-right">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          disabled={busyId === r.id || !r.email || !r.notifyEmail}
                          onClick={() => void resend("one", "link", r.id)}
                        >
                          {busyId === r.id ? "Enviando…" : "Enlace"}
                        </Button>
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
            baja: no reciben ni el enlace ni los recordatorios. Escríbeles por
            WhatsApp desde su ficha.
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
};

export default WebinarRegistrantsPanel;
